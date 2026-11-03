import { describe, expect, it } from "bun:test";
import { acceptsEntry } from "./accept";

function file(name: string, mime?: string) {
  return {
    kind: "file" as const,
    name,
    ...(mime
      ? { mime }
      : {}),
  };
}

describe("acceptsEntry", () => {
  it("accepts everything without a list", () => {
    expect(acceptsEntry(file("a.txt"), undefined)).toBe(true);
    expect(acceptsEntry(file("a.txt"), [])).toBe(true);
  });

  it("matches extensions case-insensitively", () => {
    expect(acceptsEntry(file("dot.PNG"), [".png"])).toBe(true);
    expect(acceptsEntry(file("dot.png"), [".JPG", ".Png"])).toBe(true);
    expect(acceptsEntry(file("README.md"), [".png"])).toBe(false);
    expect(acceptsEntry(file("png"), [".png"])).toBe(false);
  });

  it("matches MIME globs and exact types", () => {
    expect(acceptsEntry(file("dot.png", "image/png"), ["image/*"])).toBe(true);
    expect(acceptsEntry(file("a.txt", "text/plain"), ["image/*"])).toBe(false);
    expect(acceptsEntry(file("a.txt", "text/plain"), ["text/plain"])).toBe(true);
    expect(acceptsEntry(file("a.html", "text/html"), ["text/plain"])).toBe(false);
  });

  it("rejects MIME patterns when the entry has no mime", () => {
    expect(acceptsEntry(file("dot.png"), ["image/*"])).toBe(false);
    expect(acceptsEntry(file("dot.png"), ["image/*", ".png"])).toBe(true);
  });

  it("always accepts folders", () => {
    expect(acceptsEntry({ kind: "dir", name: "images" }, [".png"])).toBe(true);
  });
});
