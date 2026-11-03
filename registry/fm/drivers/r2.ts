import type { FmDriver, FmDriverEntry, FmMultipart, FmUploadPart, FmWriteOptions } from "../server/driver";
import { FmError } from "../core/errors";
import { basename, isWithin } from "../core/path";
import { ALL_CAPS, READ_ONLY_CAPS } from "../core/schema";
import { readAll } from "../server/driver";

/** The subset of the Workers `R2Object` the driver reads. */
export interface FmR2Object {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  customMetadata?: Record<string, string>;
}

export interface FmR2ObjectBody extends FmR2Object {
  body: ReadableStream<Uint8Array>;
}

export interface FmR2Objects {
  objects: FmR2Object[];
  delimitedPrefixes: string[];
  truncated: boolean;
  cursor?: string;
}

export interface FmR2UploadedPart {
  partNumber: number;
  etag: string;
}

export interface FmR2MultipartUpload {
  readonly uploadId: string;
  uploadPart: (partNumber: number, value: Uint8Array<ArrayBuffer>) => Promise<FmR2UploadedPart>;
  complete: (uploadedParts: FmR2UploadedPart[]) => Promise<FmR2Object>;
  abort: () => Promise<void>;
}

export type FmR2Body = ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>;

/** The subset of the Workers `R2Bucket` binding the driver uses; pass `env.BUCKET` as is. */
export interface FmR2Bucket {
  head: (key: string) => Promise<FmR2Object | null>;
  get: (key: string, options?: { range?: { offset: number; length: number } }) => Promise<FmR2ObjectBody | null>;
  put: (key: string, value: FmR2Body, options?: { onlyIf?: { etagMatches?: string }; customMetadata?: Record<string, string> }) => Promise<FmR2Object | null>;
  delete: (keys: string[]) => Promise<void>;
  list: (options?: { prefix?: string; delimiter?: string; cursor?: string; limit?: number; include?: "customMetadata"[] }) => Promise<FmR2Objects>;
  createMultipartUpload: (key: string) => Promise<FmR2MultipartUpload>;
  resumeMultipartUpload: (key: string, uploadId: string) => FmR2MultipartUpload;
}

export interface FmR2DriverOptions {
  /** The R2 bucket binding, e.g. `env.BUCKET`. */
  bucket: FmR2Bucket;
  /** Key prefix used as the mount root, e.g. `users/42/`. */
  prefix?: string;
  readOnly?: boolean;
  /** Max objects touched by one recursive copy / move / delete (default 1000). */
  maxObjects?: number;
}

/** Driver-internal directory below the prefix holding multipart part records. */
const PARTS_DIR = ".fm-r2-parts";

/** Maps an R2 binding error (`message (code)`) to an FmError where one fits. */
function r2Error(what: string, err: unknown): unknown {
  const code = err instanceof Error
    ? /\((\d+)\)\s*$/.exec(err.message)?.[1]
    : undefined;
  if (code === "10024")
    return new FmError("NOT_FOUND", `Upload not found: ${what}`);
  if (code === "10011" || code === "10025" || code === "10048")
    return new FmError("INVALID", `${what}: ${(err as Error).message}`);
  return err;
}

async function mapped<T>(what: string, p: Promise<T>): Promise<T> {
  try {
    return await p;
  }
  catch (err) {
    throw r2Error(what, err);
  }
}

/** Cloudflare R2 driver over the Workers bucket binding. */
export function r2Driver(opts: FmR2DriverOptions): FmDriver {
  const bucket = opts.bucket;
  const prefix = (opts.prefix ?? "").replace(/^\/+/, "").replace(/\/*$/, opts.prefix ? "/" : "");
  const maxObjects = opts.maxObjects ?? 1000;
  const partsRoot = `${prefix}${PARTS_DIR}/`;

  const fileKey = (path: string) => prefix + path.slice(1);
  const dirKey = (path: string) => (path === "/"
    ? prefix
    : `${fileKey(path)}/`);
  const pathOf = (key: string) => `/${key.slice(prefix.length).replace(/\/$/, "")}`;
  const partsKey = (uploadId: string) => `${partsRoot}${encodeURIComponent(uploadId)}/`;

  const isReserved = (path: string) => path === `/${PARTS_DIR}` || path.startsWith(`/${PARTS_DIR}/`);
  const notReserved = (path: string) => {
    if (isReserved(path))
      throw new FmError("NOT_FOUND", `Not found: ${path}`);
  };
  const allowedTarget = (path: string) => {
    if (isReserved(path))
      throw new FmError("INVALID", `Reserved path: ${path}`);
  };

  /** Every object under `keyPrefix` (recursive), capped at `max`. */
  const listAll = async (keyPrefix: string, max = Infinity, path = keyPrefix): Promise<FmR2Object[]> => {
    const out: FmR2Object[] = [];
    let cursor: string | undefined;
    do {
      const page = await bucket.list({
        prefix: keyPrefix,
        include: ["customMetadata"],
        ...(cursor
          ? { cursor }
          : {}),
      });
      out.push(...page.objects);
      if (out.length > max)
        throw new FmError("TOO_LARGE", `More than ${max} objects under ${path}`);
      cursor = page.truncated
        ? page.cursor
        : undefined;
    } while (cursor);
    return out;
  };

  const listTree = (path: string) => listAll(dirKey(path), maxObjects, path);

  const removeKeys = async (keys: string[]) => {
    for (let i = 0; i < keys.length; i += 1000)
      await bucket.delete(keys.slice(i, i + 1000));
  };

  const fileEntry = (path: string, o: FmR2Object): FmDriverEntry =>
    ({
      path,
      name: basename(path),
      kind: "file",
      size: o.size,
      mtime: o.uploaded.getTime(),
      etag: o.etag,
    });
  const dirEntry = (path: string, mtime = 0): FmDriverEntry =>
    ({
      path,
      name: path === "/"
        ? ""
        : basename(path),
      kind: "dir",
      size: 0,
      mtime,
      etag: "dir",
    });

  const isDir = async (path: string) =>
    path === "/" || (await bucket.list({
      prefix: dirKey(path),
      limit: 1,
    })).objects.length > 0;

  const stat = async (path: string): Promise<FmDriverEntry> => {
    notReserved(path);
    if (path !== "/") {
      const o = await bucket.head(fileKey(path));
      if (o)
        return fileEntry(path, o);
    }
    if (await isDir(path))
      return dirEntry(path);
    throw new FmError("NOT_FOUND", `Not found: ${path}`);
  };

  const exists = (path: string) => stat(path).then(() => true, () => false);

  const writable = () => {
    if (opts.readOnly)
      throw new FmError("UNSUPPORTED", "Mount is read-only");
  };

  /** R2 only accepts streams of known length: fix the length on Workers, else buffer. */
  const putBody = async (body: ReadableStream<Uint8Array> | Uint8Array, size?: number): Promise<FmR2Body> => {
    const { FixedLengthStream } = globalThis as { FixedLengthStream?: new (length: number) => TransformStream<Uint8Array, Uint8Array> };
    if (body instanceof ReadableStream && size !== undefined && FixedLengthStream)
      return body.pipeThrough(new FixedLengthStream(size));
    return readAll(body);
  };

  const copyObject = async (from: string, to: string) => {
    const o = await bucket.get(from);
    if (!o)
      throw new FmError("NOT_FOUND", `Not found: ${from}`);
    await bucket.put(to, await putBody(o.body, o.size));
  };

  const inBatches = async <T>(items: T[], fn: (item: T) => Promise<unknown>) => {
    for (let i = 0; i < items.length; i += 8)
      await Promise.all(items.slice(i, i + 8).map(fn));
  };

  /** Rejects a write to `path` that `write` / `complete` must refuse. */
  const checkTarget = async (path: string, o: FmWriteOptions) => {
    allowedTarget(path);
    const current = await bucket.head(fileKey(path));
    if (!current && await isDir(path))
      throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
    if (current && o.exclusive)
      throw new FmError("EXISTS", `Already exists: ${path}`);
    if (o.ifMatch !== undefined && current?.etag !== o.ifMatch)
      throw new FmError("ETAG_MISMATCH", "File changed since it was read");
  };

  /** Part records of an upload (marker excluded); NOT_FOUND when the upload is unknown. */
  const partRecords = async (uploadId: string): Promise<{ keys: string[]; parts: FmUploadPart[] }> => {
    const marker = partsKey(uploadId);
    const objects = await listAll(marker);
    if (objects.length === 0)
      throw new FmError("NOT_FOUND", `Upload not found: ${uploadId}`);
    const parts = objects
      .filter(o => o.key !== marker)
      .map(o => ({
        n: Number(o.customMetadata?.n),
        size: Number(o.customMetadata?.size),
        etag: o.customMetadata?.etag ?? "",
      }))
      .sort((a, b) => a.n - b.n);
    return {
      keys: objects.map(o => o.key),
      parts,
    };
  };

  const multipart: FmMultipart = {
    minPartSize: 5 * 1024 * 1024,
    maxParts: 10000,
    async begin(path) {
      allowedTarget(path);
      const upload = await bucket.createMultipartUpload(fileKey(path));
      const id = upload.uploadId;
      await bucket.put(partsKey(id), new Uint8Array());
      return id;
    },
    async uploadPart(path, uploadId, n, body, size) {
      const bytes = await readAll(body);
      if (bytes.byteLength !== size)
        throw new FmError("INVALID", `Part ${n} is ${bytes.byteLength} bytes, expected ${size}`);
      const part = await mapped(`UploadPart ${path}`, bucket.resumeMultipartUpload(fileKey(path), uploadId).uploadPart(n, bytes));
      const etag = part.etag.replace(/"/g, "");
      await bucket.put(`${partsKey(uploadId)}${n}`, new Uint8Array(), {
        customMetadata: {
          n: String(n),
          size: String(size),
          etag,
        },
      });
      return { n, size, etag };
    },
    async listParts(_path, uploadId) {
      return (await partRecords(uploadId)).parts;
    },
    async complete(path, uploadId, parts, o = {}) {
      parts.forEach((p, i) => {
        if (p.n !== i + 1)
          throw new FmError("INVALID", `Missing part ${i + 1}`);
      });
      if (parts.length === 0)
        throw new FmError("INVALID", "No parts to complete");
      const records = await partRecords(uploadId);
      for (const p of parts) {
        if (records.parts.find(r => r.n === p.n)?.etag !== p.etag)
          throw new FmError("INVALID", `Unknown part ${p.n}`);
      }
      await checkTarget(path, o);
      await mapped(`CompleteMultipartUpload ${path}`, bucket.resumeMultipartUpload(fileKey(path), uploadId)
        .complete(parts.map(p => ({ partNumber: p.n, etag: p.etag }))));
      await removeKeys(records.keys);
      return stat(path);
    },
    async abort(path, uploadId) {
      const keys = (await listAll(partsKey(uploadId))).map(o => o.key);
      if (keys.length === 0)
        return;
      try {
        await mapped(`AbortMultipartUpload ${path}`, bucket.resumeMultipartUpload(fileKey(path), uploadId).abort());
      }
      catch (err) {
        if (!(err instanceof FmError && err.code === "NOT_FOUND"))
          throw err;
      }
      await removeKeys(keys);
    },
  };

  /** Copies `from` to `to`; returns the source keys so `move` can delete them. */
  const transfer = async (from: string, to: string): Promise<string[]> => {
    writable();
    allowedTarget(to);
    if (from === "/" || isWithin(to, from))
      throw new FmError("INVALID", "Cannot move or copy a directory into itself");
    const src = await stat(from);
    if (await exists(to))
      throw new FmError("EXISTS", `Already exists: ${to}`);
    if (src.kind === "file") {
      await copyObject(fileKey(from), fileKey(to));
      return [
        fileKey(from),
      ];
    }
    const objects = await listTree(from);
    const fromKey = dirKey(from);
    const toKey = dirKey(to);
    await inBatches(objects, o => copyObject(o.key, toKey + o.key.slice(fromKey.length)));
    return objects.map(o => o.key);
  };

  return {
    name: "r2",
    caps: opts.readOnly ? READ_ONLY_CAPS : ALL_CAPS,
    stat,
    async list(path) {
      notReserved(path);
      const keyPrefix = dirKey(path);
      const out: FmDriverEntry[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({
          prefix: keyPrefix,
          delimiter: "/",
          ...(cursor
            ? { cursor }
            : {}),
        });
        for (const p of page.delimitedPrefixes) {
          if (p !== partsRoot)
            out.push(dirEntry(pathOf(p)));
        }
        for (const o of page.objects) {
          if (o.key !== keyPrefix)
            out.push(fileEntry(pathOf(o.key), o));
        }
        cursor = page.truncated
          ? page.cursor
          : undefined;
      } while (cursor);
      if (out.length === 0 && path !== "/") {
        const self = await stat(path);
        if (self.kind !== "dir")
          throw new FmError("NOT_A_DIR", `Not a directory: ${path}`);
      }
      return out;
    },
    async read(path, range) {
      notReserved(path);
      const o = path === "/"
        ? null
        : await bucket.get(fileKey(path), range
            ? {
                range: { offset: range.start, length: range.end - range.start + 1 },
              }
            : {});
      if (!o) {
        if (await isDir(path))
          throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
        throw new FmError("NOT_FOUND", `Not found: ${path}`);
      }
      return {
        body: o.body,
        size: o.size,
        ...(range
          ? { range }
          : {}),
      };
    },
    async write(path, body, o = {}) {
      writable();
      await checkTarget(path, o);
      const put = await bucket.put(fileKey(path), await putBody(body, o.size), o.ifMatch === undefined
        ? {}
        : {
            onlyIf: { etagMatches: o.ifMatch },
          });
      if (!put)
        throw new FmError("ETAG_MISMATCH", "File changed since it was read");
      return fileEntry(path, put);
    },
    async mkdir(path) {
      writable();
      allowedTarget(path);
      if (await exists(path))
        throw new FmError("EXISTS", `Already exists: ${path}`);
      await bucket.put(dirKey(path), new Uint8Array());
      return dirEntry(path, Date.now());
    },
    async move(from, to) {
      const sources = await transfer(from, to);
      await removeKeys(sources);
      return stat(to);
    },
    async copy(from, to) {
      await transfer(from, to);
      return stat(to);
    },
    async remove(path) {
      writable();
      if (path === "/")
        throw new FmError("INVALID", "Cannot remove the root");
      const entry = await stat(path);
      await removeKeys(entry.kind === "file"
        ? [
            fileKey(path),
          ]
        : (await listTree(path)).map(o => o.key));
    },
    ...(opts.readOnly
      ? {}
      : { multipart }),
  };
}
