import type { FmTransport, FmUploadTask } from "./upload";
import { describe, expect, it } from "bun:test";
import { createUploadQueue } from "./upload";

function deferredTransport() {
  const pending = new Map<string, { resolve: () => void; reject: (e: Error) => void; progress: (n: number) => void }>();
  const transport: FmTransport = (task, _file, onProgress, signal) => new Promise((resolve, reject) => {
    pending.set(task.id, { resolve, reject, progress: onProgress });
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
  return { transport, pending };
}

function file(name: string, size = 3) {
  return Object.assign(new Blob([
    "x".repeat(size),
  ]), { name });
}
const flush = () => new Promise(r => setTimeout(r, 0));

describe("upload queue", () => {
  it("runs with bounded concurrency and builds target paths", async () => {
    const { transport, pending } = deferredTransport();
    const uploaded: FmUploadTask[] = [];
    const q = createUploadQueue({
      transport,
      concurrency: 2,
      onUploaded: t => uploaded.push(t),
    });
    q.getState().enqueue("m", "/docs", [
      {
        file: file("a.txt"),
      },
      {
        file: file("b.txt"),
        relativePath: "sub/b.txt",
      },
      {
        file: file("c.txt"),
      },
    ]);
    const s = () => q.getState().tasks;
    expect(s().map(t => t.path)).toEqual(["/docs/a.txt", "/docs/sub/b.txt", "/docs/c.txt"]);
    expect(s().map(t => t.status)).toEqual(["uploading", "uploading", "queued"]);

    pending.get("u1")!.progress(2);
    expect(s()[0]!.loaded).toBe(2);
    pending.get("u1")!.resolve();
    await flush();
    expect(s().map(t => t.status)).toEqual(["done", "uploading", "uploading"]);
    expect(uploaded.map(t => t.id)).toEqual(["u1"]);

    pending.get("u2")!.reject(new Error("boom"));
    await flush();
    expect(s()[1]).toMatchObject({ status: "error", error: "boom" });
  });

  it("cancels queued and running uploads and clears finished ones", async () => {
    const { transport } = deferredTransport();
    const q = createUploadQueue({ transport, concurrency: 1 });
    q.getState().enqueue("m", "/", [
      {
        file: file("a"),
      },
      {
        file: file("b"),
      },
    ]);
    expect(q.getState().tasks[0]!.path).toBe("/a");
    q.getState().cancel("u2");
    q.getState().cancel("u1");
    await flush();
    expect(q.getState().tasks.map(t => t.status)).toEqual(["canceled", "canceled"]);
    q.getState().clearFinished();
    expect(q.getState().tasks).toEqual([]);
  });
});
