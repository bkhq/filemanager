import type { FmEntry } from "../core/schema";
import { describe, expect, it } from "bun:test";
import { markdownPlugin } from "./markdown";

const entry = (name: string, kind: FmEntry["kind"] = "file") => ({ name, kind }) as FmEntry;

describe("markdown plugin", () => {
  it("matches .md and .markdown files only", () => {
    const { match } = markdownPlugin().previewers![0]!;
    expect(match(entry("a.md"))).toBe(true);
    expect(match(entry("B.MARKDOWN"))).toBe(true);
    expect(match(entry("a.txt"))).toBe(false);
    expect(match(entry("x.md", "dir"))).toBe(false);
  });
});
