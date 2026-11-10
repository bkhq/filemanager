import type { FmDriverEntry } from "./driver";
import { describe, expect, it } from "bun:test";
import { memoryDriver } from "../drivers/memory";
import { collect } from "./archive";
import { walk } from "./walk";

describe("walk", () => {
  it("moves on to the next root when one is filtered out", async () => {
    const driver = memoryDriver({
      files: { "/a/x.txt": "x", "/b/y.txt": "y" },
    });
    const roots = [await driver.stat("/a"), await driver.stat("/b")];
    const seen: string[] = [];
    await walk(driver, roots, {
      skip: e => e.path === "/a",
      enter: async () => true,
    }, (e: FmDriverEntry) => {
      seen.push(e.path);
    });
    expect(seen).toEqual(["/b", "/b/y.txt"]);
  });

  it("stops the whole walk when visit returns false", async () => {
    const driver = memoryDriver({
      files: { "/a/x.txt": "x", "/b/y.txt": "y" },
    });
    const roots = [await driver.stat("/a"), await driver.stat("/b")];
    const seen: string[] = [];
    await walk(driver, roots, {
      skip: () => false,
      enter: async () => true,
    }, (e) => {
      seen.push(e.path);
      return e.path !== "/a/x.txt";
    });
    expect(seen).toEqual(["/a", "/a/x.txt"]);
  });
});

describe("collect", () => {
  const filter = {
    skip: () => false,
    enter: async () => true,
  };
  const limits = { maxEntries: 100, maxBytes: 1e9 };

  it("names the mount root directory entry root/", async () => {
    const driver = memoryDriver({
      files: { "/a.txt": "a" },
    });
    await driver.mkdir("/sub");
    const items = await collect(driver, ["/"], limits, filter);
    expect(items.map(i => i.name).sort()).toEqual(["root/", "root/a.txt", "root/sub/"]);
  });

  it("names a non-root archive after its basename", async () => {
    const driver = memoryDriver({
      files: { "/sub/b.txt": "b" },
    });
    const items = await collect(driver, ["/sub"], limits, filter);
    expect(items.map(i => i.name)).toEqual(["sub/", "sub/b.txt"]);
  });
});
