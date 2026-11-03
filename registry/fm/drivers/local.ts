import type { Stats } from "node:fs";
import type { FmDriver, FmDriverEntry, FmSearchOptions } from "../server/driver";
import { cp, link, lstat, mkdir, readdir, realpath, rename, rm, stat, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { FmError } from "../core/errors";
import { fuzzyRank } from "../core/fuzzy";
import { basename, dirname, isWithin } from "../core/path";
import { ALL_CAPS, READ_ONLY_CAPS } from "../core/schema";

export interface FmLocalDriverOptions {
  /** Absolute directory served as the mount root. */
  root: string;
  readOnly?: boolean;
  /** List dotfiles (default true). */
  showHidden?: boolean;
  /**
   * When true and the root is inside a git work tree, `search` lists candidates
   * with `git ls-files`, honouring .gitignore. Only files are found (git does not
   * list directories). Otherwise the router walks. git runs with fsmonitor and
   * the untracked cache disabled, literal pathspecs and a minimal environment.
   * `.git` paths become read-only through this driver: write / mkdir / move /
   * copy / remove on any path with a `.git` segment throw FORBIDDEN.
   */
  gitIgnore?: boolean;
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
export function localDriver(opts: FmLocalDriverOptions): FmDriver {
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

  const toEntry = (path: string, st: Stats & { mtimeNs?: bigint }): FmDriverEntry => ({
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

  /** Root-relative paths from `git ls-files` below `dir`; null when git fails or the root is not a work tree. */
  const gitFiles = async (dir: string, signal?: AbortSignal): Promise<string[] | null> => {
    try {
      const proc = Bun.spawn([
        "git",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "--literal-pathspecs",
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        dir === "/"
          ? "."
          : dir.slice(1),
      ], {
        cwd: await abs("/"),
        env: {
          PATH: process.env.PATH ?? "",
          ...(process.env.HOME !== undefined
            ? { HOME: process.env.HOME }
            : {}),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
        stdout: "pipe",
        stderr: "ignore",
        ...(signal
          ? { signal }
          : {}),
      });
      const [out, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ]);
      return exitCode === 0
        ? out.split("\0").filter(Boolean)
        : null;
    }
    catch {
      return null;
    }
  };

  const search = async (dir: string, q: string, o: FmSearchOptions): Promise<FmDriverEntry[] | null> => {
    const files = await gitFiles(dir, o.signal);
    if (!files)
      return null;
    let paths = files
      .map(rel => `/${rel}`)
      .filter(p => opts.showHidden !== false || !p.split("/").some(s => s.startsWith(".")));
    const relative = (path: string) => (dir === "/"
      ? path
      : path.slice(dir.length));
    if (o.mode === "fuzzy") {
      paths = fuzzyRank(q, paths, relative, paths.length);
    }
    else {
      const needle = q.toLocaleLowerCase();
      paths = paths.filter(p => basename(p).toLocaleLowerCase().includes(needle));
    }
    const out: FmDriverEntry[] = [];
    for (const p of paths) {
      if (out.length >= o.limit)
        break;
      try {
        out.push(await statAbs(p, await abs(p)));
      }
      catch {
        // Deleted but still in the index, or outside the jail.
      }
    }
    return out;
  };

  /** Throws when the mount is read-only, or when gitIgnore is set and a path is inside `.git`. */
  const writable = (...paths: string[]) => {
    if (opts.readOnly)
      throw new FmError("UNSUPPORTED", "Mount is read-only");
    for (const path of paths) {
      if (opts.gitIgnore && path.split("/").some(s => s.toLowerCase() === ".git"))
        throw new FmError("FORBIDDEN", `Forbidden: ${path}`);
    }
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
      const out: FmDriverEntry[] = [];
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
      writable(path);
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
      writable(path);
      const a = await abs(path);
      if (await exists(a))
        throw new FmError("EXISTS", `Already exists: ${path}`);
      await mkdir(a, { recursive: true }).catch(e => mapError(e, path));
      return statAbs(path, a);
    },
    async move(from, to) {
      writable(from, to);
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
      writable(from, to);
      const [a, b] = await assertTransfer(from, to);
      await cp(a, b, { recursive: true, errorOnExist: true, force: false }).catch(e => mapError(e, to));
      return statAbs(to, b);
    },
    async remove(path) {
      writable(path);
      if (path === "/")
        throw new FmError("INVALID", "Cannot remove the root");
      const a = await abs(path);
      if (!await exists(a))
        throw new FmError("NOT_FOUND", `Not found: ${path}`);
      await rm(a, { recursive: true, force: true });
    },
    ...(opts.gitIgnore
      ? { search }
      : {}),
  };
}
