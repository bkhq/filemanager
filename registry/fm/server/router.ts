import type { Context, Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Action, Caps, Conflict, Entry, MountInfo, OpResult, TrashItem, Usage } from "../core/schema";
import type { Driver, DriverEntry } from "./driver";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import { FmError } from "../core/errors";
import { assertName, basename, dirname, isWithin, joinPath, nextFreeName, normalizePath } from "../core/path";
import {
  ALL_CAPS,
  conflictSchema,
  entrySchema,
  errorBodySchema,
  intersectCaps,
  listResultSchema,
  mountInfoSchema,
  opsRequestSchema,
  opsResultSchema,
  READ_ONLY_CAPS,
  sortKeySchema,
  trashIdsSchema,
  trashItemSchema,
  usageSchema,
} from "../core/schema";
import { zipStream } from "./archive";
import { inlineType, mimeOf } from "./mime";
import { dropTrashItem, getTrashItem, listTrash, moveToTrash, TRASH_DIR, trashedPath } from "./trash";

export interface Mount {
  id: string;
  label: string;
  driver: Driver;
  readOnly?: boolean;
  /**
   * Deletes move into a hidden `/.fm-trash` folder on the same driver. On a
   * read-only mount this only hides that folder.
   */
  trash?: boolean;
}

export interface Limits {
  /** Max bytes per write / upload. */
  maxUploadBytes: number;
  /** Max entries a directory listing may hold. */
  maxListEntries: number;
  archiveMaxEntries: number;
  archiveMaxBytes: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxUploadBytes: 100 * 1024 * 1024,
  maxListEntries: 10_000,
  archiveMaxEntries: 5000,
  archiveMaxBytes: 2 * 1024 * 1024 * 1024,
};

export interface FileManagerOptions<E extends Env> {
  /** Mounts visible to the current request (resolve per user / project here). */
  mounts: (c: Context<E>) => Mount[] | Promise<Mount[]>;
  /**
   * Allowed actions for `path` and everything below it. Listings apply a
   * directory's caps to its children. Missing `read` answers 404.
   */
  authorize?: (c: Context<E>, target: { mount: Mount; path: string }) => Caps | Promise<Caps>;
  limits?: Partial<Limits>;
}

type ItemOutcome = Pick<OpResult, "entry" | "trashId">;

interface Target {
  mount: Mount;
  path: string;
  caps: Caps;
}

const TAG = "Files";
const pathQuery = z.object({
  path: z.string().default("/"),
});
function err(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: resolver(errorBodySchema),
      },
    },
  };
}
function ok(schema: z.ZodType, description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: resolver(schema),
      },
    },
  };
}
const ERRORS = {
  403: err("Forbidden"),
  404: err("Not found"),
  409: err("Conflict"),
  422: err("Invalid input"),
};

function v<S extends z.ZodType, T extends "query" | "json" | "param">(target: T, schema: S) {
  return validator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({
        error: { code: "INVALID", message: "Invalid request" },
      }, 422);
    }
  });
}

function rangeOf(header: string | undefined, size: number): { start: number; end: number } | undefined {
  const m = header
    ? /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    : null;
  if (!m || (m[1] === "" && m[2] === ""))
    return undefined;
  const start = m[1] === ""
    ? Math.max(0, size - Number(m[2]))
    : Number(m[1]);
  const end = m[1] === "" || m[2] === ""
    ? size - 1
    : Math.min(Number(m[2]), size - 1);
  if (start > end || start >= size)
    throw new FmError("RANGE", "Range not satisfiable");
  return { start, end };
}

function limitStream(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > max)
        controller.error(new FmError("TOO_LARGE", `Upload exceeds ${max} bytes`));
      else
        controller.enqueue(chunk);
    },
  }));
}

function contentDisposition(type: "inline" | "attachment", name: string) {
  return `${type}; filename="${name.replace(/[^\x20-\x7E]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Builds the file manager API. Mount it with `app.route("/api/fm", createFileManager(...))`. */
export function createFileManager<E extends Env = Env>(options: FileManagerOptions<E>): Hono<E> {
  const limits: Limits = {
    ...DEFAULT_LIMITS,
    ...options.limits,
  };
  const app = new Hono<E>();

  const mountCaps = (m: Mount) => intersectCaps(m.driver.caps, m.readOnly ? READ_ONLY_CAPS : ALL_CAPS);

  // Route handlers see a narrowed env type; the host hooks get the declared one.
  const host = (c: unknown) => c as Context<E>;

  const hasTrash = (m: Mount) => !!m.trash && mountCaps(m).delete;
  /** Paths inside the trash folder are never exposed by regular routes (also on read-only views of the same storage). */
  const hidden = (m: Mount, path: string) => !!m.trash && isWithin(path, TRASH_DIR);

  const findMount = async (c: unknown, mountId: string): Promise<Mount> => {
    const mount = (await options.mounts(host(c))).find(m => m.id === mountId);
    if (!mount)
      throw new FmError("NOT_FOUND", "Mount not found");
    return mount;
  };

  const resolve = async (c: unknown, mountId: string, rawPath: string, action?: Action): Promise<Target> => {
    const mount = await findMount(c, mountId);
    const path = normalizePath(rawPath);
    if (hidden(mount, path))
      throw new FmError("NOT_FOUND", "Not found");
    const granted = options.authorize
      ? await options.authorize(host(c), { mount, path })
      : ALL_CAPS;
    const caps = intersectCaps(mountCaps(mount), granted);
    if (!caps.read)
      throw new FmError("NOT_FOUND", "Not found");
    if (action && !caps[action])
      throw new FmError("FORBIDDEN", `Not allowed: ${action}`);
    return { mount, path, caps };
  };

  const toEntry = (t: Target, e: DriverEntry): Entry => {
    const mime = e.kind === "file"
      ? (e.mime ?? mimeOf(e.name))
      : undefined;
    return {
      mount: t.mount.id,
      path: e.path,
      name: e.name,
      kind: e.kind,
      size: e.size,
      mtime: new Date(e.mtime).toISOString(),
      ...(mime
        ? { mime }
        : {}),
      etag: e.etag,
      caps: t.caps,
    };
  };

  /** Runs one item of a batch; file-manager errors become a failed result, others reach the host. */
  const settle = async (results: OpResult[], path: string, fn: () => Promise<ItemOutcome>) => {
    try {
      results.push({
        path,
        ok: true,
        ...await fn(),
      });
    }
    catch (e) {
      if (!(e instanceof FmError))
        throw e;
      results.push({
        path,
        ok: false,
        error: { code: e.code, message: e.message },
      });
    }
  };

  const exists = (d: Driver, path: string) => d.stat(path).then(() => true, () => false);

  /** Destination path for `name` in `dir` according to the conflict mode. */
  const destination = async (d: Driver, dir: string, name: string, conflict: Conflict): Promise<string> => {
    const target = joinPath(dir, name);
    if (conflict !== "rename" || !await exists(d, target))
      return target;
    for (let n = 1; n < 1000; n++) {
      const candidate = joinPath(dir, nextFreeName(name, n));
      if (!await exists(d, candidate))
        return candidate;
    }
    throw new FmError("EXISTS", `No free name for ${name}`);
  };

  // Unknown errors go to the host's onError.
  app.onError((e, c) => {
    if (e instanceof FmError) {
      return c.json({
        error: { code: e.code, message: e.message },
      }, e.status as ContentfulStatusCode);
    }
    throw e;
  });

  app.get("/mounts", describeRoute({
    tags: [TAG],
    summary: "List mounts",
    responses: {
      200: ok(z.object({
        mounts: z.array(mountInfoSchema),
      }), "Mounts"),
    },
  }), async (c) => {
    const out: MountInfo[] = [];
    for (const mount of await options.mounts(host(c))) {
      const granted = options.authorize
        ? await options.authorize(host(c), { mount, path: "/" })
        : ALL_CAPS;
      const caps = intersectCaps(mountCaps(mount), granted);
      if (caps.read) {
        out.push({
          id: mount.id,
          label: mount.label,
          driver: mount.driver.name,
          caps,
          trash: hasTrash(mount),
        });
      }
    }
    return c.json({ mounts: out });
  });

  app.get("/m/:mount/stat", describeRoute({
    tags: [TAG],
    summary: "Stat an entry",
    responses: {
      200: ok(entrySchema, "Entry"),
      ...ERRORS,
    },
  }), v("query", pathQuery), async (c) => {
    const t = await resolve(c, c.req.param("mount"), c.req.valid("query").path);
    return c.json(toEntry(t, await t.mount.driver.stat(t.path)));
  });

  app.get("/m/:mount/list", describeRoute({
    tags: [TAG],
    summary: "List a directory",
    description: "Directories first, then sorted by `sort`. `cursor` is an opaque offset.",
    responses: {
      200: ok(listResultSchema, "Listing"),
      ...ERRORS,
    },
  }), v("query", pathQuery.extend({
    cursor: z.string().regex(/^\d+$/).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
    sort: sortKeySchema.default("name"),
    order: z.enum(["asc", "desc"]).default("asc"),
    q: z.string().max(255).optional(),
  })), async (c) => {
    const q = c.req.valid("query");
    const t = await resolve(c, c.req.param("mount"), q.path);
    const self = await t.mount.driver.stat(t.path);
    if (self.kind !== "dir")
      throw new FmError("NOT_A_DIR", "Not a directory");
    const needle = q.q?.trim().toLocaleLowerCase();
    const all = (await t.mount.driver.list(t.path))
      .filter(e => !hidden(t.mount, e.path) && (!needle || e.name.toLocaleLowerCase().includes(needle)));
    if (all.length > limits.maxListEntries)
      throw new FmError("TOO_LARGE", `Directory has more than ${limits.maxListEntries} entries`);
    const dir = q.order === "asc"
      ? 1
      : -1;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    all.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "dir"
          ? -1
          : 1;
      }
      const primary = q.sort === "name"
        ? collator.compare(a.name, b.name)
        : (q.sort === "size"
            ? a.size - b.size
            : a.mtime - b.mtime);
      return (primary || collator.compare(a.name, b.name)) * dir;
    });
    const offset = Number(q.cursor ?? 0);
    const items = all.slice(offset, offset + q.limit).map(e => toEntry(t, e));
    const next = offset + q.limit < all.length
      ? String(offset + q.limit)
      : undefined;
    return c.json({
      entry: toEntry(t, self),
      items,
      total: all.length,
      ...(next
        ? { cursor: next }
        : {}),
    });
  });

  app.get("/m/:mount/read", describeRoute({
    tags: [TAG],
    summary: "Read file content",
    description: "Supports `Range` and `If-None-Match`. Script-capable types are served as text/plain or attachment.",
    responses: {
      200: { description: "File bytes" },
      206: { description: "Partial content" },
      304: { description: "Not modified" },
      ...ERRORS,
    },
  }), v("query", pathQuery.extend({
    download: z.enum(["0", "1"]).optional(),
  })), async (c) => {
    const q = c.req.valid("query");
    const t = await resolve(c, c.req.param("mount"), q.path);
    const d = t.mount.driver;
    const e = await d.stat(t.path);
    if (e.kind !== "file")
      throw new FmError("IS_A_DIR", "Is a directory");
    const etag = `"${e.etag}"`;
    const headers = new Headers({
      "ETag": etag,
      "Last-Modified": new Date(e.mtime).toUTCString(),
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-cache",
    });
    if (c.req.header("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    const type = q.download === "1"
      ? undefined
      : inlineType(e.mime ?? mimeOf(e.name));
    headers.set("Content-Type", type ?? "application/octet-stream");
    headers.set("Content-Disposition", contentDisposition(type ? "inline" : "attachment", e.name));
    const range = rangeOf(c.req.header("range"), e.size);
    const res = await d.read(t.path, range);
    if (range) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${res.size}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(res.body, { status: 206, headers });
    }
    headers.set("Content-Length", String(res.size));
    return new Response(res.body, { status: 200, headers });
  });

  app.put("/m/:mount/write", describeRoute({
    tags: [TAG],
    summary: "Write a file",
    description: "Raw request body. `If-Match` guards overwrites; `conflict` decides what happens when the file exists.",
    responses: {
      200: ok(entrySchema, "Written entry"),
      412: err("ETag mismatch"),
      413: err("Too large"),
      ...ERRORS,
    },
  }), v("query", z.object({
    path: z.string().min(2),
    conflict: conflictSchema.default("overwrite"),
  })), async (c) => {
    const q = c.req.valid("query");
    const t = await resolve(c, c.req.param("mount"), q.path, "write");
    if (t.path === "/")
      throw new FmError("INVALID", "Invalid path");
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > limits.maxUploadBytes)
      throw new FmError("TOO_LARGE", `Upload exceeds ${limits.maxUploadBytes} bytes`);
    const ifMatch = c.req.header("if-match")?.replace(/^W\//, "").replace(/"/g, "");
    const d = t.mount.driver;
    const path = await destination(d, dirname(t.path), basename(t.path), q.conflict);
    const body = c.req.raw.body
      ? limitStream(c.req.raw.body, limits.maxUploadBytes)
      : new Uint8Array();
    const written = await d.write(path, body, {
      ...(ifMatch
        ? { ifMatch }
        : {}),
      ...(q.conflict === "fail"
        ? { exclusive: true }
        : {}),
    });
    return c.json(toEntry(t, written));
  });

  app.post("/m/:mount/mkdir", describeRoute({
    tags: [TAG],
    summary: "Create a directory",
    responses: {
      201: ok(entrySchema, "Created directory"),
      ...ERRORS,
    },
  }), v("json", z.object({
    path: z.string().min(2),
  })), async (c) => {
    const t = await resolve(c, c.req.param("mount"), c.req.valid("json").path, "write");
    return c.json(toEntry(t, await t.mount.driver.mkdir(t.path)), 201);
  });

  app.post("/m/:mount/ops", describeRoute({
    tags: [TAG],
    summary: "Batch move / copy / delete / rename",
    description: "Each item succeeds or fails on its own; the response lists per-item results.",
    responses: {
      200: ok(opsResultSchema, "Per-item results"),
      ...ERRORS,
    },
  }), v("json", opsRequestSchema), async (c) => {
    const req = c.req.valid("json");
    const mountId = c.req.param("mount");
    const results: OpResult[] = [];
    const run = (path: string, fn: () => Promise<ItemOutcome>) => settle(results, path, fn);

    if (req.op === "delete") {
      for (const p of req.paths) {
        await run(p, async () => {
          const t = await resolve(c, mountId, p, "delete");
          if (t.path === "/")
            throw new FmError("INVALID", "Cannot delete the root");
          if (hasTrash(t.mount) && !req.permanent)
            return { trashId: await moveToTrash(t.mount.driver, t.path) };
          await t.mount.driver.remove(t.path);
          return {};
        });
      }
    }
    else if (req.op === "rename") {
      await run(req.path, async () => {
        const t = await resolve(c, mountId, req.path, "rename");
        if (t.path === "/")
          throw new FmError("INVALID", "Cannot rename the root");
        assertName(req.name);
        const to = await resolve(c, mountId, joinPath(dirname(t.path), req.name), "write");
        return {
          entry: toEntry(t, await t.mount.driver.move(t.path, to.path)),
        };
      });
    }
    else {
      const dest = await resolve(c, mountId, req.dest, "write");
      for (const p of req.paths) {
        await run(p, async () => {
          const src = await resolve(c, mountId, p, req.op);
          const d = src.mount.driver;
          if (src.path === "/" || isWithin(dest.path, src.path))
            throw new FmError("INVALID", "Cannot move or copy a directory into itself");
          let to = await destination(d, dest.path, basename(src.path), req.conflict);
          if (to === src.path) {
            if (req.op === "move") {
              return {
                entry: toEntry(dest, await d.stat(to)),
              };
            }
            to = await destination(d, dest.path, basename(src.path), "rename");
          }
          if (req.conflict === "overwrite" && await exists(d, to)) {
            await resolve(c, mountId, to, "delete");
            await d.remove(to);
          }
          const moved = req.op === "move"
            ? await d.move(src.path, to)
            : await d.copy(src.path, to);
          return {
            entry: toEntry(dest, moved),
          };
        });
      }
    }
    return c.json({ results });
  });

  app.get("/m/:mount/archive", describeRoute({
    tags: [TAG],
    summary: "Download entries as a zip",
    description: "Repeat `path` for several entries. Streams an uncompressed zip.",
    responses: {
      200: { description: "Zip stream" },
      413: err("Archive too large"),
      ...ERRORS,
    },
  }), v("query", z.object({
    path: z.union([
      z.string(),
      z.array(z.string()),
    ]),
  })), async (c) => {
    const raw = c.req.valid("query").path;
    const paths = Array.isArray(raw)
      ? raw
      : [raw];
    if (paths.length === 0 || paths.length > 100)
      throw new FmError("INVALID", "Between 1 and 100 paths");
    const targets = await Promise.all(paths.map(p => resolve(c, c.req.param("mount"), p)));
    const first = targets[0]!;
    const body = await zipStream(first.mount.driver, targets.map(t => t.path), {
      maxEntries: limits.archiveMaxEntries,
      maxBytes: limits.archiveMaxBytes,
    }, p => hidden(first.mount, p));
    const name = `${targets.length === 1
      ? (basename(first.path) || first.mount.label)
      : first.mount.label}.zip`;
    return new Response(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition("attachment", name),
      },
    });
  });

  app.get("/m/:mount/usage", describeRoute({
    tags: [TAG],
    summary: "Total size of a folder",
    description: "Walks at most `archiveMaxEntries` entries; `truncated` marks a partial result.",
    responses: {
      200: ok(usageSchema, "Usage"),
      ...ERRORS,
    },
  }), v("query", pathQuery), async (c) => {
    const t = await resolve(c, c.req.param("mount"), c.req.valid("query").path);
    const d = t.mount.driver;
    const usage: Usage = {
      bytes: 0,
      files: 0,
      dirs: 0,
      truncated: false,
    };
    const root = await d.stat(t.path);
    if (root.kind === "file")
      return c.json({ ...usage, bytes: root.size, files: 1 });
    const queue = [t.path];
    let seen = 0;
    while (queue.length > 0 && !usage.truncated) {
      for (const e of await d.list(queue.shift()!)) {
        if (hidden(t.mount, e.path))
          continue;
        if (++seen > limits.archiveMaxEntries) {
          usage.truncated = true;
          break;
        }
        if (e.kind === "dir") {
          usage.dirs++;
          queue.push(e.path);
        }
        else {
          usage.files++;
          usage.bytes += e.size;
        }
      }
    }
    return c.json(usage);
  });

  const trashMount = async (c: unknown, mountId: string) => {
    const mount = await findMount(c, mountId);
    if (!hasTrash(mount))
      throw new FmError("UNSUPPORTED", "This mount has no trash");
    return mount;
  };

  app.get("/m/:mount/trash", describeRoute({
    tags: [TAG],
    summary: "List the trash",
    description: "Newest first; only items whose original path the caller may read.",
    responses: {
      200: ok(z.object({
        items: z.array(trashItemSchema),
      }), "Trash items"),
      405: err("Mount has no trash"),
      ...ERRORS,
    },
  }), async (c) => {
    const mount = await trashMount(c, c.req.param("mount"));
    const items: TrashItem[] = [];
    for (const item of await listTrash(mount.driver)) {
      if (await resolve(c, mount.id, item.path).then(() => true, () => false))
        items.push(item);
    }
    return c.json({ items });
  });

  app.post("/m/:mount/trash/restore", describeRoute({
    tags: [TAG],
    summary: "Restore trash items",
    description: "Moves items back to their original path; a name clash picks a free name.",
    responses: {
      200: ok(opsResultSchema, "Per-item results"),
      405: err("Mount has no trash"),
      ...ERRORS,
    },
  }), v("json", trashIdsSchema), async (c) => {
    const mount = await trashMount(c, c.req.param("mount"));
    const d = mount.driver;
    const results: OpResult[] = [];
    for (const id of c.req.valid("json").ids) {
      await settle(results, id, async () => {
        const item = await getTrashItem(d, id);
        const t = await resolve(c, mount.id, item.path, "write");
        const to = await destination(d, dirname(t.path), item.name, "rename");
        const entry = toEntry(t, await d.move(trashedPath(item), to));
        await dropTrashItem(d, id);
        return { entry };
      });
    }
    return c.json({ results });
  });

  app.post("/m/:mount/trash/purge", describeRoute({
    tags: [TAG],
    summary: "Delete trash items permanently",
    description: "Without `ids`, empties every item the caller may delete.",
    responses: {
      200: ok(opsResultSchema, "Per-item results"),
      405: err("Mount has no trash"),
      ...ERRORS,
    },
  }), v("json", trashIdsSchema.partial()), async (c) => {
    const mount = await trashMount(c, c.req.param("mount"));
    const d = mount.driver;
    const ids = c.req.valid("json").ids ?? (await listTrash(d)).map(i => i.id);
    const results: OpResult[] = [];
    for (const id of ids) {
      await settle(results, id, async () => {
        const item = await getTrashItem(d, id);
        await resolve(c, mount.id, item.path, "delete");
        await dropTrashItem(d, id);
        return {};
      });
    }
    return c.json({ results });
  });

  return app;
}
