import { describe, expect, it } from "bun:test";
import { isFmError } from "./errors";
import { assertName, basename, dirname, isWithin, joinPath, nextFreeName, normalizePath } from "./path";

describe("normalizePath", () => {
  it("normalizes slashes and dots", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("a//b/./c/")).toBe("/a/b/c");
  });

  it.each(["../x", "/a/../b", "a\\b", "a\0b"])("rejects %p", (input) => {
    let err: unknown;
    try {
      normalizePath(input);
    }
    catch (e) {
      err = e;
    }
    expect(isFmError(err, "INVALID")).toBe(true);
  });
});

describe("path helpers", () => {
  it("joins, splits and compares", () => {
    expect(joinPath("/", "a")).toBe("/a");
    expect(joinPath("/a", "b")).toBe("/a/b");
    expect(dirname("/a/b")).toBe("/a");
    expect(dirname("/a")).toBe("/");
    expect(basename("/a/b.txt")).toBe("b.txt");
    expect(isWithin("/a/b", "/a")).toBe(true);
    expect(isWithin("/ab", "/a")).toBe(false);
    expect(isWithin("/x", "/")).toBe(true);
  });

  it("rejects bad names", () => {
    expect(() => assertName("a/b")).toThrow();
    expect(() => assertName("..")).toThrow();
    expect(() => assertName("")).toThrow();
    expect(() => assertName("ok.txt")).not.toThrow();
  });

  it("builds free names", () => {
    expect(nextFreeName("a.txt", 1)).toBe("a (1).txt");
    expect(nextFreeName("a (1).txt", 2)).toBe("a (2).txt");
    expect(nextFreeName("dir", 3)).toBe("dir (3)");
    expect(nextFreeName(".env", 1)).toBe(".env (1)");
  });
});
