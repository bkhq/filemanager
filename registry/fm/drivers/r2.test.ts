import type { FmR2Bucket, FmR2DriverOptions } from "./r2";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Miniflare } from "miniflare";
import { runDriverContract } from "../server/contract";
import { readAll } from "../server/driver";
import { r2Driver } from "./r2";

const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('') } }",
  r2Buckets: ["FM_TEST_BUCKET"],
});
let bucket: FmR2Bucket;

beforeAll(async () => {
  // miniflare's binding types need @cloudflare/workers-types, which is not installed.
  const raw = await mf.getR2Bucket("FM_TEST_BUCKET") as unknown as FmR2Bucket;
  // Bun cannot transfer the ReadableStream behind miniflare's synchronous
  // `body` getter between threads, so bodies are read with `arrayBuffer()`.
  bucket = new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop !== "get")
        return Reflect.get(target, prop, receiver) as unknown;
      const get: FmR2Bucket["get"] = async (key, options) => {
        const o = await target.get(key, options) as (Awaited<ReturnType<FmR2Bucket["get"]>> & { arrayBuffer: () => Promise<ArrayBuffer> }) | null;
        if (!o)
          return null;
        const bytes = new Uint8Array(await o.arrayBuffer());
        return {
          key: o.key,
          size: o.size,
          etag: o.etag,
          uploaded: o.uploaded,
          body: new Response(bytes).body!,
        };
      };
      return get;
    },
  });
});

afterAll(async () => {
  await mf.dispose();
});

function fresh(o: Partial<FmR2DriverOptions> = {}) {
  return r2Driver({
    bucket,
    prefix: `t-${crypto.randomUUID()}/`,
    ...o,
  });
}

const enc = new TextEncoder();

runDriverContract("r2", async () => {
  const driver = fresh();
  return {
    driver,
    cleanup: async () => {
      for (const e of await driver.list("/"))
        await driver.remove(e.path);
    },
  };
});

describe("r2Driver specifics", () => {
  it("round-trips awkward key names", async () => {
    const driver = fresh();
    const path = "/dir é/a b+c#?&=.txt";
    await driver.write(path, enc.encode("x"));
    expect((await driver.list("/dir é")).map(e => e.name)).toEqual(["a b+c#?&=.txt"]);
    expect(new TextDecoder().decode(await readAll((await driver.read(path)).body))).toBe("x");
    await driver.remove("/dir é");
  });

  it("caps recursive operations", async () => {
    const driver = fresh({ maxObjects: 2 });
    for (const n of ["a", "b", "c"])
      await driver.write(`/d/${n}.txt`, enc.encode(n));
    await expect(driver.copy("/d", "/e")).rejects.toMatchObject({ code: "TOO_LARGE" });
    await expect(driver.remove("/d")).rejects.toMatchObject({ code: "TOO_LARGE" });
    for (const n of ["a", "b", "c"])
      await driver.remove(`/d/${n}.txt`);
  });

  it("reports read-only caps", async () => {
    const driver = fresh({ readOnly: true });
    expect(driver.name).toBe("r2");
    expect(driver.caps.write).toBe(false);
    expect(driver.multipart).toBeUndefined();
    await expect(driver.write("/a.txt", enc.encode("a"))).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("writes a sized stream", async () => {
    const driver = fresh();
    const data = new Uint8Array(1024 * 1024).map((_, i) => i % 251);
    const e = await driver.write("/big.bin", new Response(data).body!, { size: data.byteLength });
    expect(e.size).toBe(data.byteLength);
    expect(await readAll((await driver.read("/big.bin")).body)).toEqual(data);
    await driver.remove("/big.bin");
  });

  it("pipes sized streams through FixedLengthStream when available", async () => {
    const lengths: number[] = [];
    class FixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
      constructor(length: number) {
        super();
        lengths.push(length);
      }
    }
    const g = globalThis as { FixedLengthStream?: unknown };
    g.FixedLengthStream = FixedLengthStream;
    const seen: unknown[] = [];
    const driver = r2Driver({
      prefix: `t-${crypto.randomUUID()}/`,
      bucket: new Proxy(bucket, {
        get(target, prop, receiver) {
          if (prop !== "put")
            return Reflect.get(target, prop, receiver) as unknown;
          const put: FmR2Bucket["put"] = async (key, value, options) => {
            seen.push(value);
            return target.put(key, await readAll(value), options);
          };
          return put;
        },
      }),
    });
    try {
      await driver.write("/s.txt", new Response("abc").body!, { size: 3 });
    }
    finally {
      delete g.FixedLengthStream;
    }
    expect(lengths).toEqual([3]);
    expect(seen[0]).toBeInstanceOf(ReadableStream);
    expect(new TextDecoder().decode(await readAll((await driver.read("/s.txt")).body))).toBe("abc");
    await driver.remove("/s.txt");
  });

  it("hides and rejects the reserved part-record prefix", async () => {
    const driver = fresh();
    const mp = driver.multipart!;
    const id = await mp.begin("/p.bin");
    await mp.uploadPart!("/p.bin", id, 1, enc.encode("hi"), 2);
    expect(await driver.list("/")).toEqual([]);
    await expect(driver.stat("/.fm-r2-parts")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(driver.list("/.fm-r2-parts")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(driver.read(`/.fm-r2-parts/${id}/1`)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(driver.write("/.fm-r2-parts/x", enc.encode("x"))).rejects.toMatchObject({ code: "INVALID" });
    await expect(driver.mkdir("/.fm-r2-parts/d")).rejects.toMatchObject({ code: "INVALID" });
    await driver.write("/a.txt", enc.encode("a"));
    await expect(driver.copy("/a.txt", "/.fm-r2-parts/a.txt")).rejects.toMatchObject({ code: "INVALID" });
    await expect(driver.move("/a.txt", "/.fm-r2-parts")).rejects.toMatchObject({ code: "INVALID" });
    await expect(mp.begin("/.fm-r2-parts/b")).rejects.toMatchObject({ code: "INVALID" });
    await driver.remove("/a.txt");
    await mp.abort("/p.bin", id);
    expect((await bucket.list({ prefix: "" })).objects.filter(o => o.key.includes(id))).toEqual([]);
  });

  it("validates parts and upload ids", async () => {
    const driver = fresh();
    const mp = driver.multipart!;
    await expect(mp.listParts("/u.bin", "unknown")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(mp.uploadPart!("/u.bin", "unknown", 1, enc.encode("x"), 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await mp.abort("/u.bin", "unknown");
    const id = await mp.begin("/u.bin");
    expect(await mp.listParts("/u.bin", id)).toEqual([]);
    await expect(mp.uploadPart!("/u.bin", id, 1, enc.encode("abc"), 2)).rejects.toMatchObject({ code: "INVALID" });
    await expect(mp.complete("/u.bin", id, [])).rejects.toMatchObject({ code: "INVALID" });
    const part = await mp.uploadPart!("/u.bin", id, 1, new Response("ab").body!, 2);
    await expect(mp.complete("/u.bin", id, [
      { ...part, etag: "bogus" },
    ])).rejects.toMatchObject({ code: "INVALID" });
    await driver.write("/u.bin", enc.encode("old"));
    const current = await driver.stat("/u.bin");
    await expect(mp.complete("/u.bin", id, [part], { ifMatch: "stale" })).rejects.toMatchObject({ code: "ETAG_MISMATCH" });
    const e = await mp.complete("/u.bin", id, [part], { ifMatch: current.etag });
    expect(e.size).toBe(2);
    await expect(mp.listParts("/u.bin", id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await driver.remove("/u.bin");
    expect(await driver.list("/")).toEqual([]);
  });

  it("checks write preconditions", async () => {
    const driver = fresh();
    await driver.mkdir("/dir");
    await expect(driver.write("/dir", enc.encode("x"))).rejects.toMatchObject({ code: "IS_A_DIR" });
    await expect(driver.read("/")).rejects.toMatchObject({ code: "IS_A_DIR" });
    await driver.write("/f.txt", enc.encode("f"));
    await expect(driver.list("/f.txt")).rejects.toMatchObject({ code: "NOT_A_DIR" });
    await expect(driver.remove("/")).rejects.toMatchObject({ code: "INVALID" });
    await driver.remove("/f.txt");
    await driver.remove("/dir");
  });
});
