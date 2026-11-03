import type { FmOpResult } from "../core/schema";
import { describe, expect, it } from "bun:test";
import { undoFor } from "./undo";

function entry(path: string) {
  return {
    mount: "m",
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    kind: "file" as const,
    size: 1,
    mtime: "",
    etag: "",
    caps: {
      read: true,
      write: true,
      delete: true,
      rename: true,
      move: true,
      copy: true,
    },
  };
}
function ok(path: string, to?: string, trashId?: string): FmOpResult {
  return {
    path,
    ok: true,
    ...(to
      ? {
          entry: entry(to),
        }
      : {}),
    ...(trashId
      ? { trashId }
      : {}),
  };
}

describe("undoFor", () => {
  it("restores trashed deletes and ignores permanent ones", () => {
    expect(undoFor({
      op: "delete",
      paths: ["/a", "/b"],
    }, [
      ok("/a", undefined, "t1"),
      { path: "/b", ok: false },
    ]))
      .toEqual({
        restore: ["t1"],
      });
    expect(undoFor({
      op: "delete",
      paths: ["/a"],
    }, [
      ok("/a"),
    ])).toBeUndefined();
  });

  it("renames back", () => {
    expect(undoFor({ op: "rename", path: "/d/a.txt", name: "b.txt" }, [
      ok("/d/a.txt", "/d/b.txt"),
    ]))
      .toEqual({
        ops: [
          { op: "rename", path: "/d/b.txt", name: "a.txt" },
        ],
      });
  });

  it("moves back grouped by original folder, skipping no-op moves", () => {
    expect(undoFor({
      op: "move",
      paths: ["/x/a", "/x/b", "/y/c", "/z/d"],
      dest: "/z",
    }, [
      ok("/x/a", "/z/a"),
      ok("/x/b", "/z/b (1)"),
      ok("/y/c", "/z/c"),
      ok("/z/d", "/z/d"),
    ])).toEqual({
      ops: [
        {
          op: "move",
          paths: ["/z/a", "/z/b (1)"],
          dest: "/x",
          conflict: "fail",
        },
        {
          op: "move",
          paths: ["/z/c"],
          dest: "/y",
          conflict: "fail",
        },
      ],
    });
  });

  it("deletes copies permanently", () => {
    expect(undoFor({
      op: "copy",
      paths: ["/a"],
      dest: "/",
    }, [
      ok("/a", "/a (1)"),
    ]))
      .toEqual({
        ops: [
          {
            op: "delete",
            paths: ["/a (1)"],
            permanent: true,
          },
        ],
      });
    expect(undoFor({
      op: "copy",
      paths: ["/a"],
      dest: "/",
    }, [
      { path: "/a", ok: false },
    ])).toBeUndefined();
  });
});
