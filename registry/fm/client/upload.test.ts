import type { FmUploadSession } from "../core/schema";
import type { FmClient } from "./client";
import type { FmPartTransport, FmTransport, FmUploadTask } from "./upload";
import { describe, expect, it } from "bun:test";
import { FmApiError } from "./client";
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

function memoryStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function fakeClient(over: Partial<FmUploadSession> = {}, getUpload?: () => Promise<FmUploadSession>) {
  const calls: string[] = [];
  const session = (): FmUploadSession => ({
    id: "s1",
    mode: "chunked",
    path: "/big (1).bin",
    size: 10,
    partSize: 4,
    parts: 3,
    received: [],
    expiresAt: 0,
    ...over,
  });
  const client = {
    headers: () => ({ authorization: "Bearer t" }),
    createUpload: async (mount: string, body: unknown) => {
      calls.push(`create ${mount} ${JSON.stringify(body)}`);
      return session();
    },
    getUpload: async (_mount: string, id: string) => {
      calls.push(`get ${id}`);
      return getUpload
        ? getUpload()
        : session();
    },
    uploadPartUrl: (mount: string, id: string, n: number) => `/m/${mount}/uploads/${id}/parts/${n}`,
    completeUpload: async (_mount: string, id: string) => {
      calls.push(`complete ${id}`);
      return {};
    },
    abortUpload: async (_mount: string, id: string) => {
      calls.push(`abort ${id}`);
    },
  };
  return { client: client as unknown as FmClient, calls };
}

function recordingParts(fail: (url: string, attempt: number) => Error | undefined = () => undefined) {
  const puts: { url: string; text: string; headers: Record<string, string> }[] = [];
  const attempts = new Map<string, number>();
  const partTransport: FmPartTransport = async (url, body, headers, onProgress) => {
    const attempt = attempts.get(url) ?? 0;
    attempts.set(url, attempt + 1);
    const err = fail(url, attempt);
    if (err)
      throw err;
    puts.push({ url, text: await body.text(), headers });
    onProgress(body.size);
  };
  return { partTransport, puts };
}

const KEY = "fm-upload:m:/big.bin:10:7:big.bin";
const big = () => new File(["0123456789"], "big.bin", { lastModified: 7 });

async function settle(q: ReturnType<typeof createUploadQueue>) {
  for (let i = 0; i < 100 && q.getState().tasks.some(t => t.status === "uploading"); i++)
    await flush();
  return q.getState().tasks[0]!;
}

describe("upload sessions", () => {
  const base = { retryDelayMs: 0, sessionThreshold: 10 };

  it("uses the single-PUT transport below the threshold", async () => {
    const { client, calls } = fakeClient();
    const used: string[] = [];
    const q = createUploadQueue({
      ...base,
      client,
      storage: memoryStorage(),
      transport: async (task) => {
        used.push(task.path);
      },
    });
    q.getState().enqueue("m", "/", [
      {
        file: file("small.txt", 9),
      },
    ]);
    expect(await settle(q)).toMatchObject({ status: "done" });
    expect(used).toEqual(["/small.txt"]);
    expect(calls).toEqual([]);
  });

  it("uploads all parts of a chunked session and completes", async () => {
    const { client, calls } = fakeClient();
    const { partTransport, puts } = recordingParts();
    const storage = memoryStorage();
    const uploaded: FmUploadTask[] = [];
    const q = createUploadQueue({
      ...base,
      client,
      storage,
      partTransport,
      transport: async () => {
        throw new Error("unused");
      },
      onUploaded: t => uploaded.push(t),
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    expect(await settle(q)).toMatchObject({ status: "done", loaded: 10, path: "/big (1).bin" });
    expect(calls).toEqual([
      `create m {"path":"/big.bin","size":10,"conflict":"rename"}`,
      "complete s1",
    ]);
    expect(puts).toEqual([1, 2, 3].map((n, i) => ({
      url: `/m/m/uploads/s1/parts/${n}`,
      text: ["0123", "4567", "89"][i]!,
      headers: { authorization: "Bearer t" },
    })));
    expect(storage.map.size).toBe(0);
    expect(uploaded[0]!.path).toBe("/big (1).bin");
  });

  it("sends s3-multipart parts to presigned urls without auth headers", async () => {
    const { client } = fakeClient({
      mode: "s3-multipart",
      urls: ["https://s3/1", "https://s3/2", "https://s3/3"],
    });
    const { partTransport, puts } = recordingParts();
    const q = createUploadQueue({
      ...base,
      client,
      storage: memoryStorage(),
      partTransport,
      transport: async () => {},
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    expect(await settle(q)).toMatchObject({ status: "done" });
    expect(puts.map(p => [p.url, p.headers])).toEqual([1, 2, 3].map(n => [`https://s3/${n}`, {}]));
  });

  it("refreshes presigned urls after a 403", async () => {
    let fresh = false;
    const { client, calls } = fakeClient({
      mode: "s3-multipart",
      urls: ["https://s3/1", "https://s3/2", "https://s3/3"],
    }, async () => {
      fresh = true;
      return {
        id: "s1",
        mode: "s3-multipart",
        path: "/big (1).bin",
        size: 10,
        partSize: 4,
        parts: 3,
        received: [1],
        urls: ["https://s3/1?new", "https://s3/2?new", "https://s3/3?new"],
        expiresAt: 0,
      };
    });
    const { partTransport, puts } = recordingParts(url => (url === "https://s3/2" && !fresh
      ? new FmApiError(403, "HTTP_ERROR", "Forbidden")
      : undefined));
    const q = createUploadQueue({
      ...base,
      client,
      storage: memoryStorage(),
      partTransport,
      transport: async () => {},
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    expect(await settle(q)).toMatchObject({ status: "done" });
    expect(calls).toContain("get s1");
    expect(puts.map(p => p.url)).toEqual(["https://s3/1", "https://s3/2?new", "https://s3/3?new"]);
  });

  it("retries a failing part", async () => {
    const { client } = fakeClient();
    const { partTransport, puts } = recordingParts((url, attempt) => (url.endsWith("/2") && attempt < 2
      ? new Error("flaky")
      : undefined));
    const q = createUploadQueue({
      ...base,
      client,
      storage: memoryStorage(),
      partTransport,
      transport: async () => {},
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    expect(await settle(q)).toMatchObject({ status: "done" });
    expect(puts.map(p => p.text)).toEqual(["0123", "4567", "89"]);
  });

  it("fails after the retries and keeps the session for resume", async () => {
    const { client, calls } = fakeClient();
    const { partTransport } = recordingParts(url => (url.endsWith("/2")
      ? new Error("down")
      : undefined));
    const storage = memoryStorage();
    const q = createUploadQueue({
      ...base,
      retries: 2,
      client,
      storage,
      partTransport,
      transport: async () => {},
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    expect(await settle(q)).toMatchObject({ status: "error", error: "down", loaded: 4 });
    expect(storage.map.get(KEY)).toBe("s1");
    expect(calls).not.toContain("complete s1");
  });

  it("resumes a remembered session", async () => {
    const { client, calls } = fakeClient({
      received: [1, 2],
    });
    const { partTransport, puts } = recordingParts();
    const storage = memoryStorage({ [KEY]: "s1" });
    const q = createUploadQueue({
      ...base,
      client,
      storage,
      partTransport,
      transport: async () => {},
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    expect(await settle(q)).toMatchObject({ status: "done", loaded: 10 });
    expect(calls).toEqual(["get s1", "complete s1"]);
    expect(puts.map(p => p.url)).toEqual(["/m/m/uploads/s1/parts/3"]);
    expect(storage.map.size).toBe(0);
  });

  it("starts a new session when the remembered one is gone", async () => {
    const { client, calls } = fakeClient({}, async () => {
      throw new FmApiError(404, "NOT_FOUND", "gone");
    });
    const { partTransport, puts } = recordingParts();
    const storage = memoryStorage({ [KEY]: "old" });
    const q = createUploadQueue({
      ...base,
      client,
      storage,
      partTransport,
      transport: async () => {},
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    expect(await settle(q)).toMatchObject({ status: "done" });
    expect(calls[0]).toBe("get old");
    expect(calls[1]).toStartWith("create m");
    expect(puts).toHaveLength(3);
  });

  it("aborts the session on cancel", async () => {
    const { client, calls } = fakeClient();
    let started!: () => void;
    const partStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const partTransport: FmPartTransport = (_url, _body, _headers, _onProgress, signal) => new Promise((_resolve, reject) => {
      started();
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    const storage = memoryStorage();
    const q = createUploadQueue({
      ...base,
      client,
      storage,
      partTransport,
      transport: async () => {},
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    await partStarted;
    expect(storage.map.get(KEY)).toBe("s1");
    q.getState().cancel("u1");
    expect(await settle(q)).toMatchObject({ status: "canceled" });
    await flush();
    expect(calls).toContain("abort s1");
    expect(storage.map.size).toBe(0);
  });
});
