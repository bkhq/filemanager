import type { FmMountInfo } from "../core/schema";
import { describe, expect, it } from "bun:test";
import { groupMountsByDriver, parseHidden, visibleMounts } from "./mount-visibility";

const caps = {
  read: true,
  write: true,
  delete: true,
  rename: true,
  move: true,
  copy: true,
};
function mount(id: string, driver: string): FmMountInfo {
  return {
    id,
    label: id,
    driver,
    caps,
    trash: false,
  };
}
const all = [
  mount("a", "local"),
  mount("b", "memory"),
  mount("c", "local"),
  mount("d", "s3"),
];
const ids = (ms: FmMountInfo[]) => ms.map(m => m.id);

describe("visibleMounts", () => {
  it("shows everything when nothing is hidden", () => {
    expect(ids(visibleMounts(all, [], [], undefined))).toEqual(["a", "b", "c", "d"]);
  });

  it("drops host and user hidden ids and their union", () => {
    expect(ids(visibleMounts(all, ["b"], [], undefined))).toEqual(["a", "c", "d"]);
    expect(ids(visibleMounts(all, [], ["c"], undefined))).toEqual(["a", "b", "d"]);
    expect(ids(visibleMounts(all, ["b"], ["c", "b"], undefined))).toEqual(["a", "d"]);
  });

  it("never hides the current mount", () => {
    expect(ids(visibleMounts(all, ["a"], ["b"], "a"))).toEqual(["a", "c", "d"]);
    expect(ids(visibleMounts(all, [], ["d"], "d"))).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores unknown ids and keeps order", () => {
    expect(ids(visibleMounts(all, ["x"], ["y", "c"], "z"))).toEqual(["a", "b", "d"]);
  });
});

describe("groupMountsByDriver", () => {
  it("groups in order of first appearance", () => {
    expect(groupMountsByDriver(all).map(g => [
      g.driver,
      ids(g.mounts),
    ])).toEqual([
      [
        "local",
        ["a", "c"],
      ],
      [
        "memory",
        ["b"],
      ],
      [
        "s3",
        ["d"],
      ],
    ]);
    expect(groupMountsByDriver([])).toEqual([]);
  });
});

describe("parseHidden", () => {
  it("tolerates missing and corrupt values", () => {
    expect(parseHidden(null)).toEqual([]);
    expect(parseHidden("not json")).toEqual([]);
    expect(parseHidden("{\"a\":1}")).toEqual([]);
    expect(parseHidden("[\"a\",1,\"b\"]")).toEqual(["a", "b"]);
  });
});
