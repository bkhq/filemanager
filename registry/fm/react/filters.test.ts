import { describe, expect, it } from "bun:test";
import { applyFilters, filterKindOf, modifiedSince, NO_FILTERS, parseFilters } from "./filters";

function file(name: string, mime?: string, mtime = "2026-11-05T10:00:00.000Z") {
  return {
    kind: "file" as const,
    name,
    mime,
    mtime,
  };
}
const dir = (name: string) => ({ kind: "dir" as const, name, mtime: "2020-01-01T00:00:00.000Z" });

describe("filterKindOf", () => {
  it("classifies by kind, MIME type and extension", () => {
    expect(filterKindOf(dir("src"))).toBe("folder");
    expect(filterKindOf(file("a.png", "image/png"))).toBe("image");
    expect(filterKindOf(file("a.mp4", "video/mp4"))).toBe("video");
    expect(filterKindOf(file("a.mp3", "audio/mpeg"))).toBe("audio");
    expect(filterKindOf(file("a.pdf", "application/pdf"))).toBe("document");
    expect(filterKindOf(file("Report.DOCX"))).toBe("document");
    expect(filterKindOf(file("deck.pptx"))).toBe("document");
    expect(filterKindOf(file("data.csv", "text/csv"))).toBe("sheet");
    expect(filterKindOf(file("book.xlsx"))).toBe("sheet");
    expect(filterKindOf(file("main.ts"))).toBe("code");
    expect(filterKindOf(file("notes.md"))).toBe("code");
    expect(filterKindOf(file("a.zip", "application/zip"))).toBe("archive");
    expect(filterKindOf(file("a.tar.gz"))).toBe("archive");
    expect(filterKindOf(file("blob"))).toBe("other");
  });
});

describe("modifiedSince", () => {
  const now = new Date("2026-11-05T12:00:00");
  it("returns the start of each range in local time", () => {
    expect(modifiedSince("any", now)).toBeUndefined();
    expect(modifiedSince("today", now)).toEqual(new Date("2026-11-05T00:00:00"));
    expect(modifiedSince("7d", now)).toEqual(new Date("2026-10-29T12:00:00"));
    expect(modifiedSince("30d", now)).toEqual(new Date("2026-10-06T12:00:00"));
    expect(modifiedSince("year", now)).toEqual(new Date("2026-01-01T00:00:00"));
  });
});

describe("applyFilters", () => {
  const entries = [
    dir("docs"),
    file("a.png", "image/png", "2026-11-05T09:00:00Z"),
    file("b.ts", undefined, "2026-01-02T00:00:00Z"),
    file("c.csv", "text/csv", "2025-06-01T00:00:00Z"),
  ];
  const now = new Date("2026-11-05T12:00:00Z");
  const names = (xs: readonly { name: string }[]) => xs.map(x => x.name);

  it("passes everything without filters", () => {
    expect(applyFilters(entries, { types: [], modified: "any" }, { now })).toBe(entries);
  });
  it("keeps entries of any selected type", () => {
    expect(names(applyFilters(entries, {
      types: ["image", "sheet"],
      modified: "any",
    }, { now }))).toEqual(["a.png", "c.csv"]);
  });
  it("filters by modified date, folders included unless keepFolders", () => {
    expect(names(applyFilters(entries, { types: [], modified: "30d" }, { now }))).toEqual(["a.png"]);
    expect(names(applyFilters(entries, {
      types: ["code"],
      modified: "year",
    }, { now, keepFolders: true }))).toEqual(["docs", "b.ts"]);
  });
});

describe("parseFilters", () => {
  it("keeps known values only", () => {
    expect(parseFilters(JSON.stringify({
      types: ["image", "nope"],
      modified: "7d",
    }))).toEqual({
      types: ["image"],
      modified: "7d",
    });
    expect(parseFilters("{bad")).toEqual(NO_FILTERS);
    expect(parseFilters(null)).toEqual(NO_FILTERS);
    expect(parseFilters(JSON.stringify({ modified: "forever" }))).toEqual(NO_FILTERS);
  });
});
