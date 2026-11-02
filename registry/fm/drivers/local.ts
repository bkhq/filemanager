import type { Stats } from "node:fs";
import type { Driver, DriverEntry } from "../server/driver";
import { cp, link, lstat, mkdir, readdir, realpath, rename, rm, stat, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { FmError } from "../core/errors";
import { basename, dirname, isWithin } from "../core/path";
import { ALL_CAPS, READ_ONLY_CAPS } from "../core/schema";

export interface LocalDriverOptions {
  /** Absolute directory served as the mount root. */
  root: string;
  readOnly?: boolean;
  /** List dotfiles (default true). */
  showHidden?: boolean;
}

const ERRNO: Record<string, ConstructorParameters<typeof FmError>[0]> = {
  ENOENT: "NOT_FOUND",
  EEXIST: "EXISTS",
  ENOTDIR: "NOT_A_DIR",
  EISDIR: "IS_A_DIR",
  ENOTEMPTY: "NOT_EMPTY",
  ERR_FS_CP_EEXIST: "EXISTS",
};

function mapError(err: unknown, path: string): never {
  const code = (err as { code?: string }).code;
  const mapped = code ? ERRNO[code] : undefined;
  if (mapped)
    throw new FmError(mapped, `${mapped}: ${path}`);
  throw err;
}

async function exists(abs: string): Promise<boolean> {
  try {
    await lstat(abs);
    return true;
  }
  catch {
    return false;
  }
}

/** Local filesystem driver (Bun only). Every access is jailed to `root`, symlinks included. */
export function localDriver(opts: LocalDriverOptions): Driver {
  const root = resolve(opts.root);
  let realRoot: Promise<string> | undefined;
  const getRealRoot = () => (realRoot ??= realpath(root));

  const inside = (real: string, rr: string) => real === rr || real.startsWith(rr + sep);

  /** Absolute path for `path`, after checking the nearest existing ancestor resolves inside root. */
  const abs = async (path: string): Promise<string> => {
    const target = path === "/"
      ? root
      : join(root, path.slice(1));
    const rr = await getRealRoot();
    let probe = target;
    for (;;) {
      try {
        if (!inside(await realpath(probe), rr))
          throw new FmError("NOT_FOUND", `Not found: ${path}`);
        return target;
      }
      catch (err) {
        if ((err as { code?: string }).code !== "ENOENT" || probe === root) {
          throw err instanceof FmError
            ? err
            : mapError(err, path);
        }
        probe = resolve(probe, "..");
      }
    }
  };

  const toEntry = (path: string, st: Stats & { mtimeNs?: bigint }): DriverEntry => ({
    path,
    name: path === "/"
      ? ""
      : basename(path),
    kind: st.isDirectory()
      ? "dir"
      : "file",
    size: st.isDirectory()
      ? 0
      : Number(st.size),
    mtime: Number(st.mtimeMs),
    etag: `${Number(st.size).toString(36)}-${(st.mtimeNs ?? BigInt(Math.trunc(Number(st.mtimeMs) * 1e6))).toString(36)}`,
  });

  const statAbs = async (path: string, a: string) => {
    try {
      return toEntry(path, await stat(a, { bigint: true }) as unknown as Stats & { mtimeNs: bigint });
    }
    catch (err) {
      return mapError(err, path);
    }
  };

  const assertTransfer = async (from: string, to: string) => {
    if (from === "/" || isWithin(to, from))
      throw new FmError("INVALID", "Cannot move or copy a directory into itself");
    const [a, b] = [await abs(from), await abs(to)];
    if (!await exists(a))
      throw new FmError("NOT_FOUND", `Not found: ${from}`);
    if (await exists(b))
      throw new FmError("EXISTS", `Already exists: ${to}`);
    await mkdir(await abs(dirname(to)), { recursive: true }).catch(e => mapError(e, to));
    return [a, b] as const;
  };

  const writable = () => {
    if (opts.readOnly)
      throw new FmError("UNSUPPORTED", "Mount is read-only");
  };

  return {
    name: "local",
    caps: opts.readOnly ? READ_ONLY_CAPS : ALL_CAPS,
    async stat(path) {
      return statAbs(path, await abs(path));
    },
    async list(path) {
      const dir = await abs(path);
      const rr = await getRealRoot();
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      }
      catch (err) {
        return mapError(err, path);
      }
      const out: DriverEntry[] = [];
      for (const d of dirents) {
        if (opts.showHidden === false && d.name.startsWith("."))
          continue;
        const childPath = path === "/"
          ? `/${d.name}`
          : `${path}/${d.name}`;
        const a = join(dir, d.name);
        try {
          if (d.isSymbolicLink() && !inside(await realpath(a), rr))
            continue;
          out.push(await statAbs(childPath, a));
        }
        catch {
          // Dangling symlinks and entries removed mid-listing are skipped.
        }
      }
      return out;
    },
    async read(path, range) {
      const a = await abs(path);
      const entry = await statAbs(path, a);
      if (entry.kind !== "file")
        throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
      const file = Bun.file(a);
      const body = range
        ? file.slice(range.start, range.end + 1).stream()
        : file.stream();
      return {
        body,
        size: entry.size,
        ...(range
          ? { range }
          : {}),
      };
    },
    async write(path, body, o = {}) {
      writable();
      const a = await abs(path);
      const current = await stat(a, { bigint: true }).catch(() => undefined);
      if (current?.isDirectory())
        throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
      if (current && o.exclusive)
        throw new FmError("EXISTS", `Already exists: ${path}`);
      if (o.ifMatch !== undefined && (!current || toEntry(path, current as unknown as Stats).etag !== o.ifMatch))
        throw new FmError("ETAG_MISMATCH", "File changed since it was read");
      await mkdir(resolve(a, ".."), { recursive: true }).catch(e => mapError(e, path));
      const tmp = join(resolve(a, ".."), `.${basename(path)}.fm-${crypto.randomUUID()}`);
      try {
        if (body instanceof Uint8Array)
          await Bun.write(tmp, body);
        else
          await Bun.write(tmp, new Response(body));
        if (o.exclusive) {
          await link(tmp, a).catch(e => mapError(e, path));
          await unlink(tmp);
        }
        else {
          await rename(tmp, a);
        }
      }
      catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
      return statAbs(path, a);
    },
    async mkdir(path) {
      writable();
      const a = await abs(path);
      if (await exists(a))
        throw new FmError("EXISTS", `Already exists: ${path}`);
      await mkdir(a, { recursive: true }).catch(e => mapError(e, path));
      return statAbs(path, a);
    },
    async move(from, to) {
      writable();
      const [a, b] = await assertTransfer(from, to);
      try {
        await rename(a, b);
      }
      catch (err) {
        if ((err as { code?: string }).code !== "EXDEV")
          return mapError(err, from);
        await cp(a, b, { recursive: true, errorOnExist: true, force: false });
        await rm(a, { recursive: true, force: true });
      }
      return statAbs(to, b);
    },
    async copy(from, to) {
      writable();
      const [a, b] = await assertTransfer(from, to);
      await cp(a, b, { recursive: true, errorOnExist: true, force: false }).catch(e => mapError(e, to));
      return statAbs(to, b);
    },
    async remove(path) {
      writable();
      if (path === "/")
        throw new FmError("INVALID", "Cannot remove the root");
      const a = await abs(path);
      if (!await exists(a))
        throw new FmError("NOT_FOUND", `Not found: ${path}`);
      await rm(a, { recursive: true, force: true });
    },
  };
}
