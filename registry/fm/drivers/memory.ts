import type { Driver, DriverEntry } from "../server/driver";
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

export interface MemoryDriverOptions {
  /** Initial files: path -> content. Parent directories are created. */
  files?: Record<string, string | Uint8Array>;
}

/** In-memory driver for tests and demos. */
export function memoryDriver(opts: MemoryDriverOptions = {}): Driver {
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

  const toEntry = (path: string, node: Node): DriverEntry => ({
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

  const transfer = (from: string, to: string, keepSource: boolean): DriverEntry => {
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

  const driver: Driver = {
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
      const existing = nodes.get(path);
      if (existing?.kind === "dir")
        throw new FmError("IS_A_DIR", `Is a directory: ${path}`);
      if (existing && o.exclusive)
        throw new FmError("EXISTS", `Already exists: ${path}`);
      if (o.ifMatch !== undefined && (!existing || toEntry(path, existing).etag !== o.ifMatch))
        throw new FmError("ETAG_MISMATCH", "File changed since it was read");
      const data = await readAll(body);
      ensureDir(dirname(path));
      const node = touch("file", data.slice());
      nodes.set(path, node);
      return toEntry(path, node);
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
  };

  const enc = new TextEncoder();
  for (const [path, content] of Object.entries(opts.files ?? {})) {
    ensureDir(dirname(path));
    nodes.set(path, touch("file", typeof content === "string"
      ? enc.encode(content)
      : new Uint8Array(content)));
  }
  return driver;
}
