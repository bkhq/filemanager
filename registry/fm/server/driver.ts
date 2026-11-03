import type { FmCaps, FmEntryKind } from "../core/schema";

/** An entry as seen by a driver: mount-relative path, no caller caps. */
export interface FmDriverEntry {
  path: string;
  name: string;
  kind: FmEntryKind;
  size: number;
  /** Epoch milliseconds. */
  mtime: number;
  etag: string;
  mime?: string;
}

export interface FmByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

export interface FmReadResult {
  body: ReadableStream<Uint8Array>;
  /** Full object size. */
  size: number;
  range?: FmByteRange;
}

export interface FmWriteOptions {
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
export interface FmDriver {
  readonly name: string;
  /** Actions this backend supports at all. */
  readonly caps: FmCaps;
  stat: (path: string) => Promise<FmDriverEntry>;
  list: (path: string) => Promise<FmDriverEntry[]>;
  read: (path: string, range?: FmByteRange) => Promise<FmReadResult>;
  write: (path: string, body: ReadableStream<Uint8Array> | Uint8Array, opts?: FmWriteOptions) => Promise<FmDriverEntry>;
  mkdir: (path: string) => Promise<FmDriverEntry>;
  move: (from: string, to: string) => Promise<FmDriverEntry>;
  copy: (from: string, to: string) => Promise<FmDriverEntry>;
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
