import type { Context, Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { FmAction, FmCaps, FmConflict, FmEntry, FmMountInfo, FmOpResult, FmTrashItem, FmUsage } from "../core/schema";
import type { FmDriver, FmDriverEntry } from "./driver";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import { FmError } from "../core/errors";
import { fuzzyRank, fuzzyScore } from "../core/fuzzy";
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
  searchModeSchema,
  searchResultSchema,
  sortKeySchema,
  trashIdsSchema,
  trashItemSchema,
  usageSchema,
} from "../core/schema";
import { zipStream } from "./archive";
import { inlineType, mimeOf } from "./mime";
import { dropTrashItem, getTrashItem, listTrash, moveToTrash, TRASH_DIR, trashedPath } from "./trash";

export interface FmMount {
  id: string;
  label: string;
  driver: FmDriver;
  readOnly?: boolean;
  /**
   * Deletes move into a hidden `/.fm-trash` folder on the same driver. On a
   * read-only mount this only hides that folder.
   */
  trash?: boolean;
}

export interface FmLimits {
  /** Max bytes per write / upload. */
  maxUploadBytes: number;
  /** Max entries a directory listing may hold. */
  maxListEntries: number;
  archiveMaxEntries: number;
  archiveMaxBytes: number;
}

export const DEFAULT_LIMITS: FmLimits = {
  maxUploadBytes: 100 * 1024 * 1024,
  maxListEntries: 10_000,
  archiveMaxEntries: 5000,
  archiveMaxBytes: 2 * 1024 * 1024 * 1024,
};

export interface FmRouterOptions<E extends Env> {
  /** Mounts visible to the current request (resolve per user / project here). */
  mounts: (c: Context<E>) => FmMount[] | Promise<FmMount[]>;
  /**
   * Allowed actions for `path` and everything below it. Listings apply a
   * directory's caps to its children. Missing `read` answers 404.
   */
  authorize?: (c: Context<E>, target: { mount: FmMount; path: string }) => FmCaps | Promise<FmCaps>;
  limits?: Partial<FmLimits>;
  /**
   * Called once per mutated item after the work, for successes and failures.
   * Awaited; a throwing hook is logged and never changes the response.
   */
  onEvent?: (c: Context<E>, event: FmChangeEvent) => void | Promise<void>;
}

export interface FmChangeEvent {
  op: "write" | "mkdir" | "delete" | "move" | "copy" | "rename" | "restore" | "purge";
  /** Mount id. */
  mount: string;
  path: string;
  to?: string;
  trashId?: string;
  ok: boolean;
  error?: { code: string; message: string };
}

type EventDraft = Omit<FmChangeEvent, "ok" | "error">;

type ItemOutcome = Pick<FmOpResult, "entry" | "trashId">;

interface Target {
  mount: FmMount;
  path: string;
  caps: FmCaps;
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

/** Builds the file manager API. Mount it with `app.route("/api/fm", createFmRouter(...))`. */
export function createFmRouter<E extends Env = Env>(options: FmRouterOptions<E>): Hono<E> {
  const limits: FmLimits = {
    ...DEFAULT_LIMITS,
    ...options.limits,
  };
  const app = new Hono<E>();

  const mountCaps = (m: FmMount) => intersectCaps(m.driver.caps, m.readOnly ? READ_ONLY_CAPS : ALL_CAPS);

  // Route handlers see a narrowed env type; the host hooks get the declared one.
  const host = (c: unknown) => c as Context<E>;

  const hasTrash = (m: FmMount) => !!m.trash && mountCaps(m).delete;
  /** Paths inside the trash folder are never exposed by regular routes (also on read-only views of the same storage). */
  const hidden = (m: FmMount, path: string) => !!m.trash && isWithin(path, TRASH_DIR);

  const findMount = async (c: unknown, mountId: string): Promise<FmMount> => {
    const mount = (await options.mounts(host(c))).find(m => m.id === mountId);
    if (!mount)
      throw new FmError("NOT_FOUND", "Mount not found");
    return mount;
  };

  const resolve = async (c: unknown, mountId: string, rawPath: string, action?: FmAction): Promise<Target> => {
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

  const toEntry = (t: Target, e: FmDriverEntry): FmEntry => {
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

  const emit = async (c: unknown, event: FmChangeEvent) => {
    if (!options.onEvent)
      return;
    try {
      await options.onEvent(host(c), event);
    }
    catch (e) {
      console.error("onEvent hook failed", e);
    }
  };

  /** Runs one mutation and emits its event; `fn` may refine the draft. Errors are rethrown. */
  const track = async <T>(c: unknown, event: EventDraft, fn: () => Promise<T>): Promise<T> => {
    try {
      const out = await fn();
      await emit(c, { ...event, ok: true });
      return out;
    }
    catch (e) {
      if (e instanceof FmError) {
        await emit(c, {
          ...event,
          ok: false,
          error: { code: e.code, message: e.message },
        });
      }
      throw e;
    }
  };

  /** Runs one item of a batch; file-manager errors become a failed result, others reach the host. */
  const settle = async (c: unknown, results: FmOpResult[], path: string, event: EventDraft, fn: () => Promise<ItemOutcome>) => {
    try {
      results.push({
        path,
        ok: true,
        ...await track(c, event, fn),
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

  const exists = (d: FmDriver, path: string) => d.stat(path).then(() => true, () => false);

  /** Destination path for `name` in `dir` according to the conflict mode. */
  const destination = async (d: FmDriver, dir: string, name: string, conflict: FmConflict): Promise<string> => {
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
    const out: FmMountInfo[] = [];
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
    const event: EventDraft = {
      op: "write",
      mount: c.req.param("mount"),
      path: q.path,
    };
    return track(c, event, async () => {
      const t = await resolve(c, event.mount, q.path, "write");
      event.path = t.path;
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
      event.path = path;
      return c.json(toEntry(t, written));
    });
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
    const event: EventDraft = {
      op: "mkdir",
      mount: c.req.param("mount"),
      path: c.req.valid("json").path,
    };
    return track(c, event, async () => {
      const t = await resolve(c, event.mount, event.path, "write");
      event.path = t.path;
      return c.json(toEntry(t, await t.mount.driver.mkdir(t.path)), 201);
    });
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
    const results: FmOpResult[] = [];
    const run = (path: string, event: EventDraft, fn: () => Promise<ItemOutcome>) => settle(c, results, path, event, fn);

    if (req.op === "delete") {
      for (const p of req.paths) {
        const event: EventDraft = { op: "delete", mount: mountId, path: p };
        await run(p, event, async () => {
          const t = await resolve(c, mountId, p, "delete");
          event.path = t.path;
          if (t.path === "/")
            throw new FmError("INVALID", "Cannot delete the root");
          if (hasTrash(t.mount) && !req.permanent) {
            event.trashId = await moveToTrash(t.mount.driver, t.path);
            return { trashId: event.trashId };
          }
          await t.mount.driver.remove(t.path);
          return {};
        });
      }
    }
    else if (req.op === "rename") {
      const event: EventDraft = { op: "rename", mount: mountId, path: req.path };
      await run(req.path, event, async () => {
        const t = await resolve(c, mountId, req.path, "rename");
        event.path = t.path;
        if (t.path === "/")
          throw new FmError("INVALID", "Cannot rename the root");
        assertName(req.name);
        const to = await resolve(c, mountId, joinPath(dirname(t.path), req.name), "write");
        const entry = toEntry(t, await t.mount.driver.move(t.path, to.path));
        event.to = to.path;
        return { entry };
      });
    }
    else {
      const dest = await resolve(c, mountId, req.dest, "write");
      for (const p of req.paths) {
        const event: EventDraft = { op: req.op, mount: mountId, path: p };
        await run(p, event, async () => {
          const src = await resolve(c, mountId, p, req.op);
          event.path = src.path;
          const d = src.mount.driver;
          if (src.path === "/" || isWithin(dest.path, src.path))
            throw new FmError("INVALID", "Cannot move or copy a directory into itself");
          let to = await destination(d, dest.path, basename(src.path), req.conflict);
          if (to === src.path) {
            if (req.op === "move") {
              const entry = toEntry(dest, await d.stat(to));
              event.to = to;
              return { entry };
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
          event.to = to;
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
    const usage: FmUsage = {
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

  app.get("/m/:mount/search", describeRoute({
    tags: [TAG],
    summary: "Search below a folder",
    description: "Case-insensitive name match at any depth, or with `mode=fuzzy` a fuzzy match on the path below `path`, best first. Without a driver search, walks at most `archiveMaxEntries` entries; `truncated` marks a partial result (walk budget or `limit` reached).",
    responses: {
      200: ok(searchResultSchema, "Matches"),
      ...ERRORS,
    },
  }), v("query", pathQuery.extend({
    q: z.string().trim().min(1).max(255),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    mode: searchModeSchema.default("substring"),
  })), async (c) => {
    const q = c.req.valid("query");
    const t = await resolve(c, c.req.param("mount"), q.path);
    const d = t.mount.driver;
    if ((await d.stat(t.path)).kind !== "dir")
      throw new FmError("NOT_A_DIR", "Not a directory");
    const granted = new Map<string, FmCaps>();
    const capsOf = async (path: string) => {
      let caps = granted.get(path);
      if (!caps) {
        caps = intersectCaps(mountCaps(t.mount), options.authorize
          ? await options.authorize(host(c), { mount: t.mount, path })
          : ALL_CAPS);
        granted.set(path, caps);
      }
      return caps;
    };
    const fuzzy = q.mode === "fuzzy";
    const relative = (path: string) => (t.path === "/"
      ? path
      : path.slice(t.path.length));
    let truncated = false;
    let candidates = await d.search?.(t.path, q.q, {
      limit: q.limit,
      mode: q.mode,
      signal: c.req.raw.signal,
    }) ?? null;
    if (candidates) {
      truncated = candidates.length >= q.limit;
    }
    else {
      candidates = [];
      const needle = q.q.toLocaleLowerCase();
      const queue = [t.path];
      let seen = 0;
      while (queue.length > 0 && !truncated) {
        for (const e of await d.list(queue.shift()!)) {
          if (hidden(t.mount, e.path))
            continue;
          // Fuzzy mode ranks afterwards, so it keeps every match within the budget.
          if ((!fuzzy && candidates.length >= q.limit) || ++seen > limits.archiveMaxEntries) {
            truncated = true;
            break;
          }
          if (fuzzy
            ? fuzzyScore(q.q, relative(e.path)) !== null
            : e.name.toLocaleLowerCase().includes(needle)) {
            candidates.push(e);
          }
          if (e.kind === "dir" && (await capsOf(e.path)).read)
            queue.push(e.path);
        }
      }
    }
    const items: FmEntry[] = [];
    for (const e of candidates) {
      if (hidden(t.mount, e.path))
        continue;
      const caps = await capsOf(e.path);
      if (caps.read)
        items.push(toEntry({ ...t, caps }, e));
    }
    if (fuzzy) {
      truncated ||= items.length > q.limit;
      return c.json({
        items: fuzzyRank(q.q, items, e => relative(e.path), q.limit),
        truncated,
      });
    }
    return c.json({ items, truncated });
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
    const items: FmTrashItem[] = [];
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
    const results: FmOpResult[] = [];
    for (const id of c.req.valid("json").ids) {
      const event: EventDraft = {
        op: "restore",
        mount: mount.id,
        path: id,
        trashId: id,
      };
      await settle(c, results, id, event, async () => {
        const item = await getTrashItem(d, id);
        event.path = item.path;
        const t = await resolve(c, mount.id, item.path, "write");
        const to = await destination(d, dirname(t.path), item.name, "rename");
        const entry = toEntry(t, await d.move(trashedPath(item), to));
        await dropTrashItem(d, id);
        event.to = to;
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
    const results: FmOpResult[] = [];
    for (const id of ids) {
      const event: EventDraft = {
        op: "purge",
        mount: mount.id,
        path: id,
        trashId: id,
      };
      await settle(c, results, id, event, async () => {
        const item = await getTrashItem(d, id);
        event.path = item.path;
        await resolve(c, mount.id, item.path, "delete");
        await dropTrashItem(d, id);
        return {};
      });
    }
    return c.json({ results });
  });

  return app;
}
