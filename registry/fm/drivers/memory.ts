import type { FmDriver, FmDriverEntry, FmDriverTrash, FmDriverTrashItem, FmUploadPart, FmWriteOptions } from "../server/driver";
import { FmError } from "../core/errors";
import { basename, dirname, isWithin } from "../core/path";
import { ALL_CAPS } from "../core/schema";
import { bytesStream, readAll } from "../server/driver";

interface Node {
  kind: "file" | "dir";
  data: Uint8Array<ArrayBuffer>;
  mtime: number;
  version: number;
}

export interface FmMemoryDriverOptions {
  /** Initial files: path -> content. Parent directories are created. */
  files?: Record<string, string | Uint8Array>;
  /** Keep deleted entries in the driver's own trash (`FmDriver.trash`) instead of the router's folder. */
  nativeTrash?: boolean;
}

/** In-memory driver for tests and demos. */
export function memoryDriver(opts: FmMemoryDriverOptions = {}): FmDriver {
  const nodes = new Map<string, Node>([
    [
      "/",
      {
        kind: "dir",
        data: new Uint8Array(),
        mtime: Date.now(),
        version: 0,
      },
    ],
  ]);
  let clock = 0;

  const toEntry = (path: string, node: Node): FmDriverEntry => ({
    path,
    name: path === "/"
      ? ""
      : basename(path),
    kind: node.kind,
    size: node.kind === "file"
      ? node.data.byteLength
      : 0,
    mtime: node.mtime,
    etag: `${node.version.toString(36)}-${node.data.byteLength.toString(36)}`,
    ...(node.kind === "dir"
      ? {
          hasSubfolders: [...nodes].some(([p, n]) => n.kind === "dir" && p !== "/" && dirname(p) === path),
        }
      : {}),
  });

  const get = (path: string): Node => {
    const node = nodes.get(path);
    if (!node)
      throw new FmError("NOT_FOUND", `Not found: ${path}`);
    return node;
  };

  const touch = (kind: Node["kind"], data: Uint8Array<ArrayBuffer> = new Uint8Array()): Node =>
    ({
      kind,
      data,
      mtime: Date.now(),
      version: ++clock,
    });

  const ensureDir = (path: string): void => {
    const node = nodes.get(path);
    if (node?.kind === "dir")
      return;
    if (node)
      throw new FmError("NOT_A_DIR", `Not a directory: ${path}`);
    ensureDir(dirname(path));
    nodes.set(path, touch("dir"));
  };

  const subtree = (path: string): string[] => [
    ...nodes.keys(),
  ].filter(p => isWithin(p, path));

  const assertFree = (path: string): void => {
    if (nodes.has(path))
      throw new FmError("EXISTS", `Already exists: ${path}`);
  };

  const transfer = (from: string, to: string, keepSource: boolean): FmDriverEntry => {
    get(from);
    assertFree(to);
    if (isWithin(to, from))
      throw new FmError("INVALID", "Cannot move or copy a directory into itself");
    ensureDir(dirname(to));
    for (const p of subtree(from)) {
      const node = nodes.get(p)!;
      nodes.set(to + p.slice(from.length), keepSource
        ? touch(node.kind, node.data)
        : node);
      if (!keepSource)
        nodes.delete(p);
    }
    return toEntry(to, get(to));
  };

  const checkWrite = (path: string, o: FmWriteOptions): void => {
    const existing = nodes.get(path);
    if (existing?.kind === "dir")
      throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
    if (existing && o.exclusive)
      throw new FmError("EXISTS", `Already exists: ${path}`);
    if (o.ifMatch !== undefined && (!existing || toEntry(path, existing).etag !== o.ifMatch))
      throw new FmError("ETAG_MISMATCH", "File changed since it was read");
  };

  const putFile = (path: string, data: Uint8Array<ArrayBuffer>): FmDriverEntry => {
    ensureDir(dirname(path));
    const node = touch("file", data);
    nodes.set(path, node);
    return toEntry(path, node);
  };

  const uploads = new Map<string, { path: string; parts: Map<number, FmUploadPart & { data: Uint8Array<ArrayBuffer> }> }>();
  const getUpload = (path: string, id: string) => {
    const upload = uploads.get(id);
    if (upload?.path !== path)
      throw new FmError("NOT_FOUND", `Unknown upload: ${id}`);
    return upload;
  };

  /** Deleted subtrees kept by id, paths relative to the deleted entry. */
  const nativeTrash = (): FmDriverTrash => {
    const bin = new Map<string, { item: FmDriverTrashItem; nodes: [string, Node][] }>();
    const take = (id: string) => {
      const kept = bin.get(id);
      if (!kept)
        throw new FmError("NOT_FOUND", "Trash item not found");
      return kept;
    };
    return {
      async remove(path) {
        if (path === "/")
          throw new FmError("INVALID", "Cannot remove the root");
        const node = get(path);
        const id = crypto.randomUUID();
        bin.set(id, {
          item: {
            id,
            path,
            name: basename(path),
            kind: node.kind,
            size: node.kind === "file"
              ? node.data.byteLength
              : 0,
            deletedAt: Date.now(),
          },
          nodes: subtree(path).map(p => [
            p.slice(path.length),
            nodes.get(p)!,
          ]),
        });
        for (const p of subtree(path))
          nodes.delete(p);
        return id;
      },
      async list() {
        return [
          ...bin.values(),
        ].map(k => k.item).sort((a, b) => b.deletedAt - a.deletedAt);
      },
      async get(id) {
        return take(id).item;
      },
      async restore(id, to) {
        const kept = take(id);
        assertFree(to);
        ensureDir(dirname(to));
        for (const [rel, node] of kept.nodes)
          nodes.set(to + rel, node);
        bin.delete(id);
        return toEntry(to, get(to));
      },
      async purge(id) {
        take(id);
        bin.delete(id);
      },
    };
  };

  const driver: FmDriver = {
    name: "memory",
    caps: ALL_CAPS,
    async stat(path) {
      return toEntry(path, get(path));
    },
    async list(path) {
      if (get(path).kind !== "dir")
        throw new FmError("NOT_A_DIR", `Not a directory: ${path}`);
      return [
        ...nodes.entries(),
      ]
        .filter(([p]) => p !== "/" && dirname(p) === path)
        .map(([p, n]) => toEntry(p, n));
    },
    async read(path, range) {
      const node = get(path);
      if (node.kind !== "file")
        throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
      const data = range
        ? node.data.subarray(range.start, range.end + 1)
        : node.data;
      return {
        body: bytesStream(data),
        size: node.data.byteLength,
        ...(range
          ? { range }
          : {}),
      };
    },
    async write(path, body, o = {}) {
      checkWrite(path, o);
      return putFile(path, (await readAll(body)).slice());
    },
    async mkdir(path) {
      assertFree(path);
      ensureDir(path);
      return toEntry(path, get(path));
    },
    async move(from, to) {
      return transfer(from, to, false);
    },
    async copy(from, to) {
      return transfer(from, to, true);
    },
    async remove(path) {
      if (path === "/")
        throw new FmError("INVALID", "Cannot remove the root");
      get(path);
      for (const p of subtree(path))
        nodes.delete(p);
    },
    multipart: {
      async begin(path) {
        const id = crypto.randomUUID();
        uploads.set(id, {
          path,
          parts: new Map(),
        });
        return id;
      },
      async uploadPart(path, uploadId, n, body, size) {
        const upload = getUpload(path, uploadId);
        if (!Number.isInteger(n) || n < 1 || n > 10000)
          throw new FmError("INVALID", `Invalid part number: ${n}`);
        const data = (await readAll(body)).slice();
        if (data.byteLength !== size)
          throw new FmError("INVALID", `Part ${n} is ${data.byteLength} bytes, expected ${size}`);
        const part = {
          n,
          size,
          etag: crypto.randomUUID(),
          data,
        };
        upload.parts.set(n, part);
        return { n, size, etag: part.etag };
      },
      async listParts(path, uploadId) {
        return [
          ...getUpload(path, uploadId).parts.values(),
        ]
          .sort((a, b) => a.n - b.n)
          .map(({ n, size, etag }) => ({ n, size, etag }));
      },
      async complete(path, uploadId, parts, o = {}) {
        const upload = getUpload(path, uploadId);
        const chunks = parts.map((p, i) => {
          const stored = upload.parts.get(i + 1);
          if (p.n !== i + 1 || stored?.etag !== p.etag)
            throw new FmError("INVALID", `Missing or unknown part ${i + 1}`);
          return stored.data;
        });
        checkWrite(path, o);
        const data = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
        let offset = 0;
        for (const c of chunks) {
          data.set(c, offset);
          offset += c.byteLength;
        }
        const entry = putFile(path, data);
        uploads.delete(uploadId);
        return entry;
      },
      async abort(path, uploadId) {
        if (uploads.get(uploadId)?.path === path)
          uploads.delete(uploadId);
      },
    },
  };

  const enc = new TextEncoder();
  for (const [path, content] of Object.entries(opts.files ?? {})) {
    ensureDir(dirname(path));
    nodes.set(path, touch("file", typeof content === "string"
      ? enc.encode(content)
      : new Uint8Array(content)));
  }
  if (opts.nativeTrash)
    driver.trash = nativeTrash();
  return driver;
}
