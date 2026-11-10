import type { FmUploadSession } from "../core/schema";
import type { FmClient } from "./client";
import type { FmPartTransport, FmTransport, FmUploadTask } from "./upload";
import { describe, expect, it } from "bun:test";
import { FmApiError } from "./client";
import { createUploadQueue, guardUploadsOnUnload } from "./upload";

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
/** Waits past the 100 ms progress timer used when `requestAnimationFrame` is missing. */
const tick = () => new Promise(r => setTimeout(r, 120));

/** Replaces `requestAnimationFrame` with a manual frame queue. */
function manualFrames() {
  const g = globalThis as { requestAnimationFrame?: ((cb: (t: number) => void) => number) | undefined };
  const prev = g.requestAnimationFrame;
  let frames: ((t: number) => void)[] = [];
  g.requestAnimationFrame = (cb) => {
    frames.push(cb);
    return frames.length;
  };
  return {
    pending: () => frames.length,
    run: () => {
      const due = frames;
      frames = [];
      for (const cb of due)
        cb(0);
    },
    restore: () => {
      g.requestAnimationFrame = prev;
    },
  };
}

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
    await tick();
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

  it("sends large files with one PUT to mounts without upload sessions", async () => {
    const { client, calls } = fakeClient();
    const used: string[] = [];
    const q = createUploadQueue({
      ...base,
      client,
      storage: memoryStorage(),
      sessions: mount => mount !== "flat",
      transport: async (task) => {
        used.push(task.path);
      },
    });
    q.getState().enqueue("flat", "/", [
      {
        file: file("big.bin", 99),
      },
    ]);
    expect(await settle(q)).toMatchObject({ status: "done" });
    expect(used).toEqual(["/big.bin"]);
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
      partConcurrency: 1,
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
    // The retried part lands after its parallel siblings.
    expect(puts.map(p => p.text).sort()).toEqual(["0123", "4567", "89"]);
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
    // Parts 1 and 3 land in parallel; part 2 keeps failing.
    expect(await settle(q)).toMatchObject({ status: "error", error: "down", loaded: 6 });
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

/** Part transport whose requests stay open until the test settles them. */
function controlledParts() {
  const calls: { url: string; size: number; open: boolean; aborted: boolean; progress: (n: number) => void; close: () => void; resolve: () => void }[] = [];
  let inflight = 0;
  let max = 0;
  const partTransport: FmPartTransport = (url, body, _headers, onProgress, signal) => new Promise((resolve, reject) => {
    inflight++;
    max = Math.max(max, inflight);
    const call = {
      url,
      size: body.size,
      open: true,
      aborted: false,
      progress: onProgress,
      close: () => {
        if (call.open)
          inflight--;
        call.open = false;
      },
      resolve: () => {
        call.close();
        resolve();
      },
    };
    signal.addEventListener("abort", () => {
      call.close();
      call.aborted = true;
      reject(new DOMException("Aborted", "AbortError"));
    });
    calls.push(call);
  });
  return {
    partTransport,
    calls,
    max: () => max,
    inflight: () => inflight,
  };
}

const parts = (calls: { url: string }[]) => calls.map(c => Number(c.url.split("/").pop()));

describe("parallel parts", () => {
  const base = {
    retryDelayMs: 0,
    sessionThreshold: 10,
    storage: memoryStorage(),
  };

  for (const [label, partConcurrency, bound] of [
    ["default 3", undefined, 3],
    ["option 2", 2, 2],
  ] as const) {
    it(`keeps at most ${label} parts in flight`, async () => {
      const { client, calls: api } = fakeClient({ partSize: 1, parts: 10 });
      const t = controlledParts();
      const q = createUploadQueue({
        ...base,
        client,
        partTransport: t.partTransport,
        transport: async () => {},
        ...(partConcurrency
          ? { partConcurrency }
          : {}),
      });
      q.getState().enqueue("m", "/", [
        {
          file: big(),
        },
      ]);
      await flush();
      await flush();
      expect(t.calls).toHaveLength(bound);
      for (let i = 0; i < 10; i++) {
        expect(t.inflight()).toBeLessThanOrEqual(bound);
        t.calls.find(c => c.open)!.resolve();
        await flush();
        await flush();
      }
      expect(t.max()).toBe(bound);
      expect(parts(t.calls).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(await settle(q)).toMatchObject({ status: "done", loaded: 10 });
      expect(api).toContain("complete s1");
    });
  }

  it("sums completed parts and the bytes in flight", async () => {
    const frames = manualFrames();
    try {
      const { client } = fakeClient();
      const t = controlledParts();
      const q = createUploadQueue({
        ...base,
        client,
        partTransport: t.partTransport,
        transport: async () => {},
      });
      q.getState().enqueue("m", "/", [
        {
          file: big(),
        },
      ]);
      await flush();
      await flush();
      t.calls[0]!.progress(2);
      t.calls[1]!.progress(3);
      frames.run();
      expect(q.getState().tasks[0]!.loaded).toBe(5);
      t.calls[0]!.resolve();
      await flush();
      frames.run();
      expect(q.getState().tasks[0]!.loaded).toBe(7);
    }
    finally {
      frames.restore();
    }
  });
});

describe("progress coalescing", () => {
  it("writes the store at most once per animation frame across tasks", async () => {
    const frames = manualFrames();
    try {
      const { transport, pending } = deferredTransport();
      const q = createUploadQueue({ transport });
      q.getState().enqueue("m", "/", [
        {
          file: file("a", 1000),
        },
        {
          file: file("b", 1000),
        },
      ]);
      let writes = 0;
      const off = q.subscribe(() => writes++);
      for (let i = 1; i <= 200; i++) {
        pending.get("u1")!.progress(i);
        pending.get("u2")!.progress(i * 2);
      }
      expect(writes).toBe(0);
      expect(frames.pending()).toBe(1);
      frames.run();
      expect(writes).toBe(1);
      expect(q.getState().tasks.map(t => t.loaded)).toEqual([200, 400]);
      pending.get("u1")!.progress(999);
      pending.get("u1")!.resolve();
      await flush();
      expect(q.getState().tasks[0]).toMatchObject({ status: "done", loaded: 1000 });
      off();
    }
    finally {
      frames.restore();
    }
  });

  it("falls back to a 100 ms timer and keeps the last value", async () => {
    const { transport, pending } = deferredTransport();
    const q = createUploadQueue({ transport });
    q.getState().enqueue("m", "/", [
      {
        file: file("a", 1000),
      },
    ]);
    let writes = 0;
    const off = q.subscribe(() => writes++);
    for (let i = 1; i <= 500; i++)
      pending.get("u1")!.progress(i);
    expect(writes).toBe(0);
    await tick();
    expect(writes).toBe(1);
    expect(q.getState().tasks[0]!.loaded).toBe(500);
    off();
  });

  it("keeps the last progress when a status change follows", async () => {
    const { client } = fakeClient();
    const t = controlledParts();
    const q = createUploadQueue({
      retryDelayMs: 0,
      sessionThreshold: 10,
      storage: memoryStorage(),
      client,
      partTransport: t.partTransport,
      transport: async () => {},
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    await flush();
    await flush();
    t.calls[0]!.resolve();
    await flush();
    q.getState().pause("u1");
    expect(await settle(q)).toMatchObject({ status: "paused", loaded: 4 });
  });
});

describe("pause and resume", () => {
  const base = { retryDelayMs: 0, sessionThreshold: 10 };

  it("pauses a session without aborting it and resumes the missing parts", async () => {
    const { client, calls } = fakeClient({}, async () => ({
      id: "s1",
      mode: "chunked",
      path: "/big (1).bin",
      size: 10,
      partSize: 4,
      parts: 3,
      received: [1],
      expiresAt: 0,
    }));
    const t = controlledParts();
    // Storage that forgets: the queue must remember the session id itself.
    const q = createUploadQueue({
      ...base,
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      client,
      partTransport: t.partTransport,
      transport: async () => {},
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    await flush();
    await flush();
    expect(parts(t.calls)).toEqual([1, 2, 3]);
    t.calls[0]!.resolve();
    await flush();
    q.getState().pause("u1");
    expect(await settle(q)).toMatchObject({ status: "paused", loaded: 4 });
    expect(t.calls.slice(1).every(c => c.aborted)).toBe(true);
    await flush();
    expect(calls).not.toContain("abort s1");

    q.getState().resume("u1");
    expect(q.getState().tasks[0]!.status).toBe("uploading");
    await flush();
    await flush();
    expect(calls).toContain("get s1");
    const again = t.calls.slice(3);
    expect(parts(again)).toEqual([2, 3]);
    for (const c of again)
      c.resolve();
    expect(await settle(q)).toMatchObject({ status: "done", loaded: 10 });
    expect(calls.filter(c => c.startsWith("create"))).toHaveLength(1);
    expect(calls).toContain("complete s1");
  });

  it("does not start a paused queued task until resumed", async () => {
    const { transport, pending } = deferredTransport();
    const q = createUploadQueue({ transport, concurrency: 1 });
    q.getState().enqueue("m", "/", [
      {
        file: file("a"),
      },
      {
        file: file("b"),
      },
    ]);
    q.getState().pause("u2");
    expect(q.getState().tasks[1]!.status).toBe("paused");
    pending.get("u1")!.resolve();
    await flush();
    expect(q.getState().tasks.map(t => t.status)).toEqual(["done", "paused"]);
    expect(pending.has("u2")).toBe(false);
    q.getState().resume("u2");
    expect(q.getState().tasks[1]!.status).toBe("uploading");
    pending.get("u2")!.resolve();
    await flush();
    expect(q.getState().tasks[1]!.status).toBe("done");
  });

  it("restarts a single-PUT upload from zero", async () => {
    const { transport, pending } = deferredTransport();
    const q = createUploadQueue({ transport });
    q.getState().enqueue("m", "/", [
      {
        file: file("a", 10),
      },
    ]);
    const first = pending.get("u1")!;
    first.progress(6);
    q.getState().pause("u1");
    await flush();
    expect(q.getState().tasks[0]!.status).toBe("paused");
    q.getState().resume("u1");
    expect(pending.get("u1")).not.toBe(first);
    expect(q.getState().tasks[0]).toMatchObject({ status: "uploading", loaded: 0 });
    pending.get("u1")!.resolve();
    await flush();
    expect(q.getState().tasks[0]!.status).toBe("done");
  });

  it("pauses and resumes all tasks", async () => {
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
    q.getState().pauseAll();
    await flush();
    expect(q.getState().tasks.map(t => t.status)).toEqual(["paused", "paused"]);
    q.getState().resumeAll();
    expect(q.getState().tasks.map(t => t.status)).toEqual(["uploading", "queued"]);
    q.getState().clearFinished();
    expect(q.getState().tasks).toHaveLength(2);
  });

  it("aborts the server session when a paused task is canceled", async () => {
    const { client, calls } = fakeClient();
    const t = controlledParts();
    const storage = memoryStorage();
    const q = createUploadQueue({
      ...base,
      storage,
      client,
      partTransport: t.partTransport,
      transport: async () => {},
    });
    q.getState().enqueue("m", "/", [
      {
        file: big(),
      },
    ]);
    await flush();
    await flush();
    q.getState().pause("u1");
    expect(await settle(q)).toMatchObject({ status: "paused" });
    expect(storage.map.get(KEY)).toBe("s1");
    q.getState().cancel("u1");
    await flush();
    expect(q.getState().tasks[0]!.status).toBe("canceled");
    expect(calls).toContain("abort s1");
    expect(storage.map.size).toBe(0);
  });
});

describe("leave-page guard", () => {
  it("listens for beforeunload only while uploads are queued or running", async () => {
    const log: string[] = [];
    const target = {
      addEventListener: (type: string) => void log.push(`add ${type}`),
      removeEventListener: (type: string) => void log.push(`remove ${type}`),
    };
    const { transport, pending } = deferredTransport();
    const q = createUploadQueue({ transport });
    const off = guardUploadsOnUnload(q, target);
    expect(log).toEqual([]);
    q.getState().enqueue("m", "/", [
      {
        file: file("a"),
      },
    ]);
    expect(log).toEqual(["add beforeunload"]);
    q.getState().pause("u1");
    await flush();
    expect(log).toEqual(["add beforeunload", "remove beforeunload"]);
    q.getState().resume("u1");
    pending.get("u1")!.resolve();
    await flush();
    expect(log).toEqual([
      "add beforeunload",
      "remove beforeunload",
      "add beforeunload",
      "remove beforeunload",
    ]);
    off();
    expect(log).toHaveLength(4);
  });
});
