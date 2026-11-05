import { describe, expect, it } from "bun:test";
import { indexChanges, NO_CHANGES } from "./changes";

describe("indexChanges", () => {
  it("maps paths and marks every ancestor folder", () => {
    const i = indexChanges([
      { path: "/a/b/c.txt", status: "modified" },
      { path: "/top.txt", status: "added" },
    ]);
    expect(i.byPath.get("/a/b/c.txt")?.status).toBe("modified");
    expect([...i.dirs].sort()).toEqual(["/a", "/a/b"]);
    expect(indexChanges([])).toBe(NO_CHANGES);
  });
});
