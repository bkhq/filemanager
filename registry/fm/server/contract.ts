import type { ErrorCode } from "../core/errors";
import type { Driver } from "./driver";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { isFmError } from "../core/errors";
import { readAll } from "./driver";

export interface DriverFixture {
  driver: Driver;
  cleanup?: () => Promise<void> | void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function text(driver: Driver, path: string, range?: { start: number; end: number }): Promise<string> {
  const res = await driver.read(path, range);
  return dec.decode(await readAll(res.body));
}

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  let err: unknown;
  try {
    await promise;
  }
  catch (e) {
    err = e;
  }
  expect(isFmError(err)
    ? err.code
    : err).toBe(code);
}

const names = async (driver: Driver, path: string) => (await driver.list(path)).map(e => e.name).sort();

/** Behavioural contract every driver must pass. Run it from a `*.test.ts` file. */
export function runDriverContract(label: string, make: () => Promise<DriverFixture>): void {
  describe(`driver contract: ${label}`, () => {
    let fx: DriverFixture;
    let d: Driver;

    beforeEach(async () => {
      fx = await make();
      d = fx.driver;
    });
    afterEach(async () => {
      await fx.cleanup?.();
    });

    it("stats the root as a directory", async () => {
      expect((await d.stat("/")).kind).toBe("dir");
    });

    it("writes, creating parents, then stats, lists and reads", async () => {
      const e = await d.write("/a/b/hello.txt", enc.encode("hello world"));
      expect(e).toMatchObject({
        path: "/a/b/hello.txt",
        name: "hello.txt",
        kind: "file",
        size: 11,
      });
      expect((await d.stat("/a")).kind).toBe("dir");
      expect(await names(d, "/a/b")).toEqual(["hello.txt"]);
      expect(await names(d, "/")).toEqual(["a"]);
      expect(await text(d, "/a/b/hello.txt")).toBe("hello world");
    });

    it("accepts a stream body", async () => {
      const body = new Response("streamed").body!;
      await d.write("/s.txt", body);
      expect(await text(d, "/s.txt")).toBe("streamed");
    });

    it("reads a byte range", async () => {
      await d.write("/r.txt", enc.encode("0123456789"));
      const res = await d.read("/r.txt", { start: 2, end: 5 });
      expect(res.size).toBe(10);
      expect(dec.decode(await readAll(res.body))).toBe("2345");
    });

    it("changes the etag on overwrite and honours ifMatch", async () => {
      const first = await d.write("/e.txt", enc.encode("one"));
      const second = await d.write("/e.txt", enc.encode("three"), { ifMatch: first.etag });
      expect(second.etag).not.toBe(first.etag);
      await expectCode(d.write("/e.txt", enc.encode("x"), { ifMatch: first.etag }), "ETAG_MISMATCH");
      expect(await text(d, "/e.txt")).toBe("three");
    });

    it("refuses exclusive writes over existing files", async () => {
      await d.write("/x.txt", enc.encode("1"));
      await expectCode(d.write("/x.txt", enc.encode("2"), { exclusive: true }), "EXISTS");
    });

    it("creates empty directories that show up in listings", async () => {
      const e = await d.mkdir("/empty");
      expect(e.kind).toBe("dir");
      expect(await names(d, "/")).toEqual(["empty"]);
      expect(await d.list("/empty")).toEqual([]);
      await expectCode(d.mkdir("/empty"), "EXISTS");
    });

    it("reports missing paths", async () => {
      await expectCode(d.stat("/nope"), "NOT_FOUND");
      await expectCode(d.read("/nope"), "NOT_FOUND");
    });

    it("moves files and directories", async () => {
      await d.write("/src/f.txt", enc.encode("f"));
      await d.write("/src/sub/g.txt", enc.encode("g"));
      const moved = await d.move("/src", "/dst");
      expect(moved).toMatchObject({ path: "/dst", kind: "dir" });
      await expectCode(d.stat("/src"), "NOT_FOUND");
      expect(await text(d, "/dst/sub/g.txt")).toBe("g");
      await d.move("/dst/f.txt", "/f2.txt");
      expect(await text(d, "/f2.txt")).toBe("f");
      await d.move("/f2.txt", "/deep/er/f3.txt");
      expect(await text(d, "/deep/er/f3.txt")).toBe("f");
    });

    it("copies directories and keeps the source", async () => {
      await d.write("/c/a.txt", enc.encode("a"));
      await d.write("/c/d/b.txt", enc.encode("b"));
      await d.copy("/c", "/c2");
      expect(await text(d, "/c/d/b.txt")).toBe("b");
      expect(await text(d, "/c2/d/b.txt")).toBe("b");
      expect(await names(d, "/c2")).toEqual(["a.txt", "d"]);
    });

    it("guards move and copy targets", async () => {
      await d.write("/m/a.txt", enc.encode("a"));
      await d.write("/b.txt", enc.encode("b"));
      await expectCode(d.move("/b.txt", "/m/a.txt"), "EXISTS");
      await expectCode(d.copy("/missing", "/z"), "NOT_FOUND");
      await expectCode(d.move("/m", "/m/inner"), "INVALID");
    });

    it("removes files and directories recursively", async () => {
      await d.write("/r/a.txt", enc.encode("a"));
      await d.write("/r/s/b.txt", enc.encode("b"));
      await d.write("/keep.txt", enc.encode("k"));
      await d.remove("/r");
      await expectCode(d.stat("/r"), "NOT_FOUND");
      await expectCode(d.stat("/r/s/b.txt"), "NOT_FOUND");
      expect(await names(d, "/")).toEqual(["keep.txt"]);
      await d.remove("/keep.txt");
      expect(await d.list("/")).toEqual([]);
    });

    it("rejects reading a directory as a file", async () => {
      await d.mkdir("/dir");
      await expectCode(d.read("/dir"), "IS_A_DIR");
    });
  });
}
