import type { FmDriver, FmDriverEntry, FmMultipart, FmUploadPart, FmWriteOptions } from "../server/driver";
import { AwsClient } from "aws4fetch";
import { FmError } from "../core/errors";
import { basename, isWithin } from "../core/path";
import { ALL_CAPS, READ_ONLY_CAPS } from "../core/schema";
import { readAll } from "../server/driver";

export interface FmS3DriverOptions {
  /** e.g. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com`, `http://minio:9000`. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  /** Key prefix used as the mount root, e.g. `users/42/`. */
  prefix?: string;
  /** Path-style URLs (`endpoint/bucket/key`); default true. */
  forcePathStyle?: boolean;
  readOnly?: boolean;
  /** Max objects touched by one recursive copy / move / delete (default 1000). */
  maxObjects?: number;
  /**
   * Expose presigned part URLs so browsers upload multipart parts straight to the bucket
   * (default false; parts then go through the server). Requires an endpoint reachable from
   * the browser (not an internal one like `http://rustfs:9000`) and bucket CORS allowing
   * `PUT` from the app origin and exposing the `ETag` header.
   */
  presignUploads?: boolean;
}

interface ListedObject {
  key: string;
  size: number;
  mtime: number;
  etag: string;
}

interface ListPage {
  objects: ListedObject[];
  prefixes: string[];
  next?: string;
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
};

function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      return String.fromCodePoint(e[1] === "x" || e[1] === "X"
        ? Number.parseInt(e.slice(2), 16)
        : Number(e.slice(1)));
    }
    return XML_ENTITIES[e] ?? m;
  });
}

/** Decodes a value returned with `encoding-type=url`. */
function urlDecoded(s: string): string {
  return decodeURIComponent(xmlText(s).replace(/\+/g, " "));
}

function tag(xml: string, name: string): string | undefined {
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1];
}

function blocks(xml: string, name: string): string[] {
  return [
    ...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g")),
  ].map(m => m[1] ?? "");
}

export function parseList(xml: string): ListPage {
  const objects = blocks(xml, "Contents").map(b => ({
    key: urlDecoded(tag(b, "Key") ?? ""),
    size: Number(tag(b, "Size") ?? 0),
    mtime: Date.parse(tag(b, "LastModified") ?? "") || 0,
    etag: xmlText(tag(b, "ETag") ?? "").replace(/"/g, ""),
  }));
  const prefixes = blocks(xml, "CommonPrefixes").map(b => urlDecoded(tag(b, "Prefix") ?? ""));
  const next = tag(xml, "IsTruncated") === "true"
    ? xmlText(tag(xml, "NextContinuationToken") ?? "")
    : undefined;
  return {
    objects,
    prefixes,
    ...(next
      ? { next }
      : {}),
  };
}

interface PartsPage {
  parts: FmUploadPart[];
  next?: number;
}

/** Parses a ListParts response. */
export function parseParts(xml: string): PartsPage {
  const parts = blocks(xml, "Part").map(b => ({
    n: Number(tag(b, "PartNumber") ?? 0),
    size: Number(tag(b, "Size") ?? 0),
    etag: xmlText(tag(b, "ETag") ?? "").replace(/"/g, ""),
  }));
  const next = tag(xml, "IsTruncated") === "true"
    ? Number(tag(xml, "NextPartNumberMarker") ?? 0)
    : 0;
  return {
    parts,
    ...(next
      ? { next }
      : {}),
  };
}

/** Headers that make S3 enforce `exclusive` / `ifMatch` atomically with the write. */
function conditionHeaders(o: FmWriteOptions): Record<string, string> {
  return {
    ...(o.exclusive
      ? { "if-none-match": "*" }
      : {}),
    ...(o.ifMatch === undefined
      ? {}
      : { "if-match": `"${o.ifMatch}"` }),
  };
}

/** Maps an S3 `<Error>` code to an FmError where one fits; `o` are the conditions the request carried. */
function s3Error(what: string, status: number, xml: string, o: FmWriteOptions = {}): Error {
  const code = tag(xml, "Code");
  if (code === "NoSuchUpload")
    return new FmError("NOT_FOUND", `Upload not found: ${what}`);
  // 412: a condition failed. 409 ConditionalRequestConflict: a concurrent conditional write won.
  // 404 NoSuchKey: the object an `If-Match` named is gone.
  if (status === 412 || code === "PreconditionFailed" || code === "ConditionalRequestConflict" || (code === "NoSuchKey" && o.ifMatch !== undefined)) {
    if (o.exclusive)
      return new FmError("EXISTS", "Already exists");
    if (o.ifMatch !== undefined)
      return new FmError("ETAG_MISMATCH", "File changed since it was read");
  }
  if (code === "InvalidPart" || code === "InvalidPartOrder" || code === "EntityTooSmall")
    return new FmError("INVALID", `${code}: ${xmlText(tag(xml, "Message") ?? "")}`);
  return new Error(`S3 ${what} failed: ${status} ${xml}`);
}

/** CopyObject handles sources up to 5 GiB; larger ones need a multipart copy. */
const COPY_LIMIT = 5 * 1024 ** 3;
const COPY_PART_SIZE = 512 * 1024 ** 2;

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

/** S3-compatible object storage driver (AWS S3, R2, MinIO …). Runs on Bun and Workers. */
export function s3Driver(opts: FmS3DriverOptions): FmDriver {
  const client = new AwsClient({
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    service: "s3",
    region: opts.region ?? "us-east-1",
  });
  const endpoint = new URL(opts.endpoint);
  const base = opts.forcePathStyle === false
    ? `${endpoint.protocol}//${opts.bucket}.${endpoint.host}`
    : `${endpoint.origin}/${opts.bucket}`;
  const prefix = (opts.prefix ?? "").replace(/^\/+/, "").replace(/\/*$/, opts.prefix ? "/" : "");
  const maxObjects = opts.maxObjects ?? 1000;

  const fileKey = (path: string) => prefix + path.slice(1);
  const dirKey = (path: string) => (path === "/"
    ? prefix
    : `${fileKey(path)}/`);
  const pathOf = (key: string) => `/${key.slice(prefix.length).replace(/\/$/, "")}`;

  const objectUrl = (key: string, query?: string) => `${base}/${encodeKey(key)}${query
    ? `?${query}`
    : ""}`;

  const send = async (method: string, key: string, init: { headers?: Record<string, string>; body?: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>; query?: string; conditions?: FmWriteOptions } = {}) => {
    const conditions = init.conditions ?? {};
    const headers = {
      ...init.headers,
      ...conditionHeaders(conditions),
    };
    const req: RequestInit = {
      method,
      ...(Object.keys(headers).length > 0
        ? { headers }
        : {}),
      ...(init.body
        ? { body: init.body }
        : {}),
    };
    const url = objectUrl(key, init.query);
    // A stream can only be sent once, so skip aws4fetch's retries for it.
    const res = init.body instanceof ReadableStream
      ? await fetch(await client.sign(url, req))
      : await client.fetch(url, req);
    if (res.status === 404 && method !== "GET" && conditions.ifMatch === undefined) {
      await res.body?.cancel();
      throw new FmError("NOT_FOUND", `Not found: ${key}`);
    }
    if (!res.ok && res.status !== 206 && (res.status !== 404 || method !== "GET"))
      throw s3Error(`${method} ${key}`, res.status, await res.text(), conditions);
    return res;
  };

  const listPage = async (keyPrefix: string, delimiter: boolean, token?: string, max = 1000): Promise<ListPage> => {
    const q = new URLSearchParams({
      "list-type": "2",
      "prefix": keyPrefix,
      "encoding-type": "url",
      "max-keys": String(max),
    });
    if (delimiter)
      q.set("delimiter", "/");
    if (token)
      q.set("continuation-token", token);
    const res = await client.fetch(`${base}/?${q.toString()}`);
    if (!res.ok)
      throw new Error(`S3 list failed: ${res.status} ${await res.text()}`);
    return parseList(await res.text());
  };

  /** Every object key under a directory (recursive), capped at `maxObjects`. */
  const listTree = async (path: string): Promise<ListedObject[]> => {
    const out: ListedObject[] = [];
    let token: string | undefined;
    do {
      const page = await listPage(dirKey(path), false, token);
      out.push(...page.objects);
      if (out.length > maxObjects)
        throw new FmError("TOO_LARGE", `More than ${maxObjects} objects under ${path}`);
      token = page.next;
    } while (token);
    return out;
  };

  const head = async (key: string): Promise<ListedObject | undefined> => {
    try {
      const res = await send("HEAD", key);
      return {
        key,
        size: Number(res.headers.get("content-length") ?? 0),
        mtime: Date.parse(res.headers.get("last-modified") ?? "") || 0,
        etag: (res.headers.get("etag") ?? "").replace(/"/g, ""),
      };
    }
    catch (err) {
      if (err instanceof FmError && err.code === "NOT_FOUND")
        return undefined;
      throw err;
    }
  };

  const fileEntry = (path: string, o: ListedObject): FmDriverEntry =>
    ({
      path,
      name: basename(path),
      kind: "file",
      size: o.size,
      mtime: o.mtime,
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
    path === "/" || (await listPage(dirKey(path), false, undefined, 1)).objects.length > 0;

  const stat = async (path: string): Promise<FmDriverEntry> => {
    if (path !== "/") {
      const o = await head(fileKey(path));
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

  const inBatches = async <T>(items: T[], fn: (item: T) => Promise<unknown>) => {
    for (let i = 0; i < items.length; i += 8) {
      // Settle the whole batch so no call is still in flight when this rejects.
      const failed = (await Promise.allSettled(items.slice(i, i + 8).map(fn))).find(r => r.status === "rejected");
      if (failed)
        throw failed.reason;
    }
  };

  /**
   * Rejects a write to `path` that `write` / `complete` must refuse. The request itself
   * carries `If-None-Match` / `If-Match` too, so a concurrent writer between this check and
   * the write cannot be overwritten; the check still answers IS_A_DIR and fails fast before
   * the body is sent.
   */
  const checkTarget = async (path: string, o: FmWriteOptions) => {
    const current = await head(fileKey(path));
    if (!current && await isDir(path))
      throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
    if (current && o.exclusive)
      throw new FmError("EXISTS", `Already exists: ${path}`);
    if (o.ifMatch !== undefined && current?.etag !== o.ifMatch)
      throw new FmError("ETAG_MISMATCH", "File changed since it was read");
  };

  const uploadQuery = (uploadId: string, extra: Record<string, string> = {}) =>
    new URLSearchParams({ ...extra, uploadId }).toString();

  /** Sends a request whose 2xx body may still be an `<Error>` document; returns the body. */
  const sendChecked = async (what: string, method: string, key: string, init: Parameters<typeof send>[2]) => {
    const res = await send(method, key, init);
    const text = await res.text();
    if (/<Error>/.test(text))
      throw s3Error(`${what} ${key}`, res.status, text);
    return text;
  };

  /** Copies one object; objects over 5 GiB (the CopyObject limit) use a multipart copy. */
  const copyObject = async (from: string, to: string, size: number) => {
    const source = `/${opts.bucket}/${encodeKey(from)}`;
    if (size <= COPY_LIMIT) {
      await sendChecked("CopyObject", "PUT", to, {
        headers: { "x-amz-copy-source": source },
      });
      return;
    }
    // CopyObject keeps the source content type; a multipart copy has to set it explicitly.
    const type = (await send("HEAD", from)).headers.get("content-type");
    const id = tag(await sendChecked("CreateMultipartUpload", "POST", to, {
      query: "uploads",
      ...(type
        ? {
            headers: { "content-type": type },
          }
        : {}),
    }), "UploadId");
    if (!id)
      throw new Error(`S3 CreateMultipartUpload returned no UploadId for ${to}`);
    const uploadId = xmlText(id);
    try {
      const partSize = Math.max(COPY_PART_SIZE, Math.ceil(size / 10000));
      const parts = Array.from({
        length: Math.ceil(size / partSize),
      }, (_, i) => i + 1);
      const etags: string[] = [];
      await inBatches(parts, async (n) => {
        const xml = await sendChecked("UploadPartCopy", "PUT", to, {
          query: uploadQuery(uploadId, {
            partNumber: String(n),
          }),
          headers: {
            "x-amz-copy-source": source,
            "x-amz-copy-source-range": `bytes=${(n - 1) * partSize}-${Math.min(n * partSize, size) - 1}`,
          },
        });
        etags[n - 1] = xmlText(tag(xml, "ETag") ?? "").replace(/"/g, "");
      });
      await sendChecked("CompleteMultipartUpload", "POST", to, {
        query: uploadQuery(uploadId),
        body: new TextEncoder().encode(`<CompleteMultipartUpload>${etags.map((etag, i) =>
          `<Part><PartNumber>${i + 1}</PartNumber><ETag>"${etag}"</ETag></Part>`).join("")}</CompleteMultipartUpload>`),
      });
    }
    catch (err) {
      await send("DELETE", to, {
        query: uploadQuery(uploadId),
      }).then(r => r.text(), () => {});
      throw err;
    }
  };

  const multipart: FmMultipart = {
    minPartSize: 5 * 1024 * 1024,
    maxParts: 10000,
    async begin(path) {
      const res = await send("POST", fileKey(path), { query: "uploads" });
      const id = tag(await res.text(), "UploadId");
      if (!id)
        throw new Error(`S3 CreateMultipartUpload returned no UploadId for ${path}`);
      return xmlText(id);
    },
    async uploadPart(path, uploadId, n, body, size) {
      if (body instanceof Uint8Array && body.byteLength !== size)
        throw new FmError("INVALID", `Part ${n} is ${body.byteLength} bytes, expected ${size}`);
      const res = await send("PUT", fileKey(path), {
        query: uploadQuery(uploadId, {
          partNumber: String(n),
        }),
        headers: {
          "content-length": String(size),
        },
        body: body instanceof Uint8Array
          ? await readAll(body)
          : body,
      });
      await res.text();
      return {
        n,
        size,
        etag: (res.headers.get("etag") ?? "").replace(/"/g, ""),
      };
    },
    async listParts(path, uploadId) {
      const out: FmUploadPart[] = [];
      let marker: number | undefined;
      do {
        const res = await send("GET", fileKey(path), {
          query: uploadQuery(uploadId, marker
            ? {
                "part-number-marker": String(marker),
              }
            : {}),
        });
        if (res.status === 404)
          throw s3Error(`ListParts ${path}`, 404, await res.text());
        const page = parseParts(await res.text());
        out.push(...page.parts);
        marker = page.next;
      } while (marker);
      return out.sort((a, b) => a.n - b.n);
    },
    async complete(path, uploadId, parts, o = {}) {
      parts.forEach((p, i) => {
        if (p.n !== i + 1)
          throw new FmError("INVALID", `Missing part ${i + 1}`);
      });
      if (parts.length === 0)
        throw new FmError("INVALID", "No parts to complete");
      await checkTarget(path, o);
      const xml = `<CompleteMultipartUpload>${parts.map(p =>
        `<Part><PartNumber>${p.n}</PartNumber><ETag>"${p.etag}"</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
      const res = await send("POST", fileKey(path), {
        query: uploadQuery(uploadId),
        body: new TextEncoder().encode(xml),
        conditions: o,
      });
      // S3 may report a failed completion as 200 with an <Error> body.
      const text = await res.text();
      if (/<Error>/.test(text))
        throw s3Error(`CompleteMultipartUpload ${path}`, res.status, text, o);
      return stat(path);
    },
    async abort(path, uploadId) {
      try {
        await send("DELETE", fileKey(path), {
          query: uploadQuery(uploadId),
        }).then(r => r.text());
      }
      catch (err) {
        if (!(err instanceof FmError && err.code === "NOT_FOUND"))
          throw err;
      }
    },
  };
  if (opts.presignUploads) {
    multipart.presignPart = async (path, uploadId, n, expiresIn) => {
      const url = objectUrl(fileKey(path), uploadQuery(uploadId, {
        "partNumber": String(n),
        "X-Amz-Expires": String(expiresIn),
      }));
      return (await client.sign(url, {
        method: "PUT",
        aws: { signQuery: true },
      })).url;
    };
  }

  /** Copies `from` to `to`; returns the source keys so `move` can delete them. */
  const transfer = async (from: string, to: string): Promise<string[]> => {
    writable();
    if (from === "/" || isWithin(to, from))
      throw new FmError("INVALID", "Cannot move or copy a directory into itself");
    const src = await stat(from);
    if (await exists(to))
      throw new FmError("EXISTS", `Already exists: ${to}`);
    if (src.kind === "file") {
      await copyObject(fileKey(from), fileKey(to), src.size);
      return [
        fileKey(from),
      ];
    }
    const objects = await listTree(from);
    const fromKey = dirKey(from);
    const toKey = dirKey(to);
    const copied: string[] = [];
    try {
      await inBatches(objects, async (o) => {
        const key = toKey + o.key.slice(fromKey.length);
        await copyObject(o.key, key, o.size);
        copied.push(key);
      });
    }
    catch (err) {
      // Best effort: drop the partial copy so a failed move / copy leaves no duplicates.
      await inBatches(copied, key => send("DELETE", key).then(r => r.text(), () => {}));
      throw err;
    }
    return objects.map(o => o.key);
  };

  return {
    name: "s3",
    caps: opts.readOnly ? READ_ONLY_CAPS : ALL_CAPS,
    stat,
    async list(path) {
      const keyPrefix = dirKey(path);
      const out: FmDriverEntry[] = [];
      let token: string | undefined;
      do {
        const page = await listPage(keyPrefix, true, token);
        for (const p of page.prefixes)
          out.push(dirEntry(pathOf(p)));
        for (const o of page.objects) {
          if (o.key !== keyPrefix)
            out.push(fileEntry(pathOf(o.key), o));
        }
        token = page.next;
      } while (token);
      if (out.length === 0 && path !== "/") {
        const self = await stat(path);
        if (self.kind !== "dir")
          throw new FmError("NOT_A_DIR", `Not a directory: ${path}`);
      }
      return out;
    },
    async read(path, range) {
      const res = await send("GET", fileKey(path), range
        ? {
            headers: { range: `bytes=${range.start}-${range.end}` },
          }
        : {});
      if (res.status === 404) {
        await res.body?.cancel();
        if (path === "/" || await isDir(path))
          throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
        throw new FmError("NOT_FOUND", `Not found: ${path}`);
      }
      const total = res.status === 206
        ? Number(res.headers.get("content-range")?.split("/")[1] ?? 0)
        : Number(res.headers.get("content-length") ?? 0);
      return {
        body: res.body ?? new Response("").body!,
        size: total,
        ...(range
          ? { range }
          : {}),
      };
    },
    async write(path, body, o = {}) {
      writable();
      await checkTarget(path, o);
      await send("PUT", fileKey(path), typeof o.size === "number" && body instanceof ReadableStream
        ? {
            headers: {
              "content-length": String(o.size),
            },
            body,
            conditions: o,
          }
        : { body: await readAll(body), conditions: o }).then(r => r.text());
      return stat(path);
    },
    async mkdir(path) {
      writable();
      if (await exists(path))
        throw new FmError("EXISTS", `Already exists: ${path}`);
      await send("PUT", dirKey(path), {
        body: new Uint8Array(),
      }).then(r => r.text());
      return dirEntry(path, Date.now());
    },
    async move(from, to) {
      const sources = await transfer(from, to);
      await inBatches(sources, key => send("DELETE", key).then(r => r.text()));
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
      const keys = entry.kind === "file"
        ? [
            fileKey(path),
          ]
        : (await listTree(path)).map(o => o.key);
      await inBatches(keys, key => send("DELETE", key).then(r => r.text()));
    },
    ...(opts.readOnly
      ? {}
      : { multipart }),
  };
}
