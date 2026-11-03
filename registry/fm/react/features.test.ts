import type { Entry } from "../core/schema";
import { describe, expect, it } from "bun:test";
import { ALL_FEATURES, maskEntry, resolveFeatures, VIEW_ONLY_FEATURES } from "./features";

const entry: Entry = {
  mount: "m",
  path: "/a.txt",
  name: "a.txt",
  kind: "file",
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

describe("features", () => {
  it("starts from all or view-only and applies overrides", () => {
    expect(resolveFeatures()).toEqual(ALL_FEATURES);
    expect(resolveFeatures(true)).toEqual(VIEW_ONLY_FEATURES);
    expect(resolveFeatures(true, { download: false, rename: true })).toMatchObject({ download: false, rename: true, delete: false });
  });

  it("masks entry caps", () => {
    expect(maskEntry(entry, VIEW_ONLY_FEATURES).caps).toEqual({
      read: true,
      write: false,
      delete: false,
      rename: false,
      move: false,
      copy: false,
    });
    expect(maskEntry(entry, { ...VIEW_ONLY_FEATURES, copy: true }).caps).toMatchObject({ write: true, copy: true, delete: false });
    expect(maskEntry({
      ...entry,
      caps: { ...entry.caps, rename: false },
    }, ALL_FEATURES).caps.rename).toBe(false);
  });
});
