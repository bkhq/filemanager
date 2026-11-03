import { describe, expect, it } from "bun:test";
import { fuzzyRank, fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "/src/main.ts")).toBeNull();
    expect(fuzzyScore("tm", "/src/main.ts")).toBeNull();
    expect(fuzzyScore("mt", "/src/main.ts")).not.toBeNull();
    expect(fuzzyScore("st", "/ts")).toBeNull();
  });

  it("ignores case and whitespace", () => {
    expect(fuzzyScore("MAIN", "/src/main.ts")).toBe(fuzzyScore("main", "/src/main.ts"));
    expect(fuzzyScore("main", "/src/MAIN.ts")).toBe(fuzzyScore("main", "/src/main.ts"));
    expect(fuzzyScore(" ma in ", "/src/main.ts")).toBe(fuzzyScore("main", "/src/main.ts"));
  });

  it("scores an empty query as 0", () => {
    expect(fuzzyScore("", "/a/b.txt")).toBe(0);
    expect(fuzzyScore("  ", "/")).toBe(0);
  });

  it("prefers a shorter path within a tier", () => {
    expect(fuzzyScore("main", "/main.ts")!).toBeGreaterThan(fuzzyScore("main", "/src/main.ts")!);
    expect(fuzzyScore("mn", "/main.ts")!).toBeGreaterThan(fuzzyScore("mn", "/src/main.ts")!);
  });

  it("adds a bonus for a match at a word boundary", () => {
    // Same tier, same length.
    expect(fuzzyScore("app", "/x/my-app.ts")!).toBeGreaterThan(fuzzyScore("app", "/x/myxapp.ts")!);
    expect(fuzzyScore("ts", "/x/a.ts")!).toBeGreaterThan(fuzzyScore("ts", "/x/axts")!);
    expect(fuzzyScore("ap", "/x/app.ts")!).toBeGreaterThan(fuzzyScore("ap", "/x/xap.ts")!);
    expect(fuzzyScore("src", "/src/aa")!).toBeGreaterThan(fuzzyScore("src", "/xsrc/a")!);
  });
});

describe("fuzzyRank", () => {
  it("orders by tier: basename substring > path substring > basename subsequence > path subsequence", () => {
    const paths = [
      "/c/o/n/f/i/g",
      "/x/c-o-n-f-i-g.ts",
      "/config/readme.md",
      "/deep/nested/dir/config.ts",
      "/zzz",
    ];
    expect(fuzzyRank("config", paths, p => p, 10)).toEqual([
      "/deep/nested/dir/config.ts",
      "/config/readme.md",
      "/x/c-o-n-f-i-g.ts",
      "/c/o/n/f/i/g",
    ]);
  });

  it("applies the limit and keeps input order on ties", () => {
    const items = [
      { p: "/a/b1" },
      { p: "/a/b2" },
      { p: "/a/b3" },
      { p: "/b" },
    ];
    expect(fuzzyRank("b", items, i => i.p, 3).map(i => i.p)).toEqual(["/b", "/a/b1", "/a/b2"]);
    expect(fuzzyRank("b", items, i => i.p, 0)).toEqual([]);
    expect(fuzzyRank("", items, i => i.p, 10)).toEqual(items);
  });
});
