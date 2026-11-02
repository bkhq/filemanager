import { describe, expect, it } from "bun:test";
import { EMPTY_SELECTION, formatSize, kindOf, prune, select, step } from "./state";

const order = ["/a", "/b", "/c", "/d"];
const paths = (s: { paths: ReadonlySet<string> }) => [...s.paths].sort();

describe("selection", () => {
  it("selects single, toggles and extends ranges in both directions", () => {
    let s = select(EMPTY_SELECTION, "/b", "single", order);
    expect(paths(s)).toEqual(["/b"]);
    s = select(s, "/d", "toggle", order);
    expect(paths(s)).toEqual(["/b", "/d"]);
    s = select(s, "/d", "toggle", order);
    expect(paths(s)).toEqual(["/b"]);
    s = select(select(EMPTY_SELECTION, "/c", "single", order), "/a", "range", order);
    expect(paths(s)).toEqual(["/a", "/b", "/c"]);
    expect(s.anchor).toBe("/c");
    expect(paths(select(EMPTY_SELECTION, "/b", "range", order))).toEqual(["/b"]);
  });

  it("steps with the keyboard, clamped, optionally extending", () => {
    let s = step(EMPTY_SELECTION, order, 1, false);
    expect(paths(s)).toEqual(["/a"]);
    s = step(s, order, 10, false);
    expect(paths(s)).toEqual(["/d"]);
    s = step(select(EMPTY_SELECTION, "/b", "single", order), order, 1, true);
    expect(paths(s)).toEqual(["/b", "/c"]);
    expect(step(EMPTY_SELECTION, [], 1, false)).toBe(EMPTY_SELECTION);
  });

  it("prunes paths that disappeared", () => {
    const s = select(select(EMPTY_SELECTION, "/a", "single", order), "/c", "toggle", order);
    const pruned = prune(s, ["/a", "/b"]);
    expect(paths(pruned)).toEqual(["/a"]);
    expect(pruned.anchor).toBeUndefined();
    expect(prune(pruned, ["/a"])).toBe(pruned);
  });
});

describe("format helpers", () => {
  it("formats sizes", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(20 * 1024 * 1024)).toBe("20 MB");
  });

  it("classifies entries", () => {
    expect(kindOf({ kind: "dir", name: "x" })).toBe("dir");
    expect(kindOf({ kind: "file", name: "a.png", mime: "image/png" })).toBe("image");
    expect(kindOf({ kind: "file", name: "a.pdf", mime: "application/pdf" })).toBe("pdf");
    expect(kindOf({ kind: "file", name: "main.rs" })).toBe("text");
    expect(kindOf({ kind: "file", name: "Dockerfile" })).toBe("text");
    expect(kindOf({ kind: "file", name: "a.zip", mime: "application/zip" })).toBe("archive");
    expect(kindOf({ kind: "file", name: "a.bin" })).toBe("other");
  });
});
