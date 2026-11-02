import type { Driver, DriverEntry } from "../server/driver";
import { AwsClient } from "aws4fetch";
import { FmError } from "../core/errors";
import { basename, isWithin } from "../core/path";
import { ALL_CAPS, READ_ONLY_CAPS } from "../core/schema";
import { readAll } from "../server/driver";

export interface S3DriverOptions {
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

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

/** S3-compatible object storage driver (AWS S3, R2, MinIO …). Runs on Bun and Workers. */
export function s3Driver(opts: S3DriverOptions): Driver {
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

  const send = async (method: string, key: string, init: { headers?: Record<string, string>; body?: Uint8Array<ArrayBuffer>; query?: string } = {}) => {
    const url = `${base}/${encodeKey(key)}${init.query
      ? `?${init.query}`
      : ""}`;
    const res = await client.fetch(url, {
      method,
      ...(init.headers
        ? { headers: init.headers }
        : {}),
      ...(init.body
        ? { body: init.body }
        : {}),
    });
    if (res.status === 404 && method !== "GET") {
      await res.body?.cancel();
      throw new FmError("NOT_FOUND", `Not found: ${key}`);
    }
    if (!res.ok && res.status !== 206 && res.status !== 404)
      throw new Error(`S3 ${method} ${key} failed: ${res.status} ${await res.text()}`);
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

  const fileEntry = (path: string, o: ListedObject): DriverEntry =>
    ({
      path,
      name: basename(path),
      kind: "file",
      size: o.size,
      mtime: o.mtime,
      etag: o.etag,
    });
  const dirEntry = (path: string, mtime = 0): DriverEntry =>
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

  const stat = async (path: string): Promise<DriverEntry> => {
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

  const copyObject = (from: string, to: string) =>
    send("PUT", to, {
      headers: { "x-amz-copy-source": `/${opts.bucket}/${encodeKey(from)}` },
    }).then(r => r.text());

  const inBatches = async <T>(items: T[], fn: (item: T) => Promise<unknown>) => {
    for (let i = 0; i < items.length; i += 8)
      await Promise.all(items.slice(i, i + 8).map(fn));
  };

  /** Copies `from` to `to`; returns the source keys so `move` can delete them. */
  const transfer = async (from: string, to: string): Promise<string[]> => {
    writable();
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
    name: "s3",
    caps: opts.readOnly ? READ_ONLY_CAPS : ALL_CAPS,
    stat,
    async list(path) {
      const keyPrefix = dirKey(path);
      const out: DriverEntry[] = [];
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
      const key = fileKey(path);
      const current = await head(key);
      if (!current && await isDir(path))
        throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
      if (current && o.exclusive)
        throw new FmError("EXISTS", `Already exists: ${path}`);
      if (o.ifMatch !== undefined && current?.etag !== o.ifMatch)
        throw new FmError("ETAG_MISMATCH", "File changed since it was read");
      await send("PUT", key, { body: await readAll(body) }).then(r => r.text());
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
  };
}
