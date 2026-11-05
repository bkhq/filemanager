import { describe, expect, it } from "bun:test";
import { archiveRows, buildArchiveTree } from "./archive-tree";

function e(path: string, size = 1) {
  return {
    path,
    dir: path.endsWith("/"),
    size,
    compressedSize: size,
    mtime: "2026-01-01T00:00:00.000Z",
    encrypted: false,
  };
}

describe("archive tree", () => {
  const tree = buildArchiveTree([
    e("b.txt"),
    e("src/"),
    e("src/util/math.ts", 3),
    e("src/main.ts", 2),
    e("docs/a.md"),
  ]);

  it("adds implicit folders and sorts folders first", () => {
    expect(tree.children.map(n => n.name)).toEqual(["docs", "src", "b.txt"]);
    const src = tree.children[1]!;
    expect(src.children.map(n => n.name)).toEqual(["util", "main.ts"]);
    expect(src.size).toBe(5);
  });

  it("lists rows of open folders with depth", () => {
    expect(archiveRows(tree, new Set()).map(r => `${r.depth}:${r.node.path}`)).toEqual(["0:docs/", "0:src/", "0:b.txt"]);
    expect(archiveRows(tree, new Set(["src/", "src/util/"])).map(r => `${r.depth}:${r.node.name}`)).toEqual([
      "0:docs",
      "0:src",
      "1:util",
      "2:math.ts",
      "1:main.ts",
      "0:b.txt",
    ]);
  });

  it("filters to matching files with their folders open", () => {
    expect(archiveRows(tree, new Set(), "MATH").map(r => r.node.name)).toEqual(["src", "util", "math.ts"]);
  });
});
