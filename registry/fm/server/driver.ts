import type { Caps, EntryKind } from "../core/schema";

/** An entry as seen by a driver: mount-relative path, no caller caps. */
export interface DriverEntry {
  path: string;
  name: string;
  kind: EntryKind;
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
  etag: string;
  mime?: string;
}

export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

export interface ReadResult {
  body: ReadableStream<Uint8Array>;
  /** Full object size. */
  size: number;
  range?: ByteRange;
}

export interface WriteOptions {
  /** Fail with ETAG_MISMATCH unless the current etag matches. */
  ifMatch?: string;
  /** Fail with EXISTS when the target exists. */
  exclusive?: boolean;
}

/**
 * A storage backend. Paths are normalized (`/a/b`) and mount-relative; the
 * router validates them before calling in. Errors are `FmError`s.
 *
 * Contract (checked by `runDriverContract`):
 * - `write` creates missing parent directories.
 * - `move` / `copy` fail with EXISTS when `to` exists and NOT_FOUND when `from` does not.
 * - `remove` deletes directories recursively.
 * - `list` returns direct children in any order.
 */
export interface Driver {
  readonly name: string;
  /** Actions this backend supports at all. */
  readonly caps: Caps;
  stat: (path: string) => Promise<DriverEntry>;
  list: (path: string) => Promise<DriverEntry[]>;
  read: (path: string, range?: ByteRange) => Promise<ReadResult>;
  write: (path: string, body: ReadableStream<Uint8Array> | Uint8Array, opts?: WriteOptions) => Promise<DriverEntry>;
  mkdir: (path: string) => Promise<DriverEntry>;
  move: (from: string, to: string) => Promise<DriverEntry>;
  copy: (from: string, to: string) => Promise<DriverEntry>;
  remove: (path: string) => Promise<void>;
}

export async function readAll(body: ReadableStream<Uint8Array> | Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (body instanceof Uint8Array) {
    return body.buffer instanceof ArrayBuffer
      ? body as Uint8Array<ArrayBuffer>
      : new Uint8Array(body);
  }
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
