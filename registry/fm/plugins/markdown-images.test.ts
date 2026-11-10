import { describe, expect, it } from "bun:test";
import { isAllowedImageUrl, isAllowedSrcset } from "./markdown-images";

const ORIGIN = "https://fm.example.com";

describe("isAllowedImageUrl", () => {
  it("allows same-origin absolute URLs", () => {
    expect(isAllowedImageUrl("https://fm.example.com/api/fm/raw?p=a.png", ORIGIN)).toBe(true);
    expect(isAllowedImageUrl("HTTPS://FM.EXAMPLE.COM/a.png", ORIGIN)).toBe(true);
  });

  it("allows relative URLs", () => {
    expect(isAllowedImageUrl("/x.png", ORIGIN)).toBe(true);
    expect(isAllowedImageUrl("./x.png", ORIGIN)).toBe(true);
    expect(isAllowedImageUrl("../img/x.png", ORIGIN)).toBe(true);
    expect(isAllowedImageUrl("x.png", ORIGIN)).toBe(true);
    expect(isAllowedImageUrl("img/x%20y.png?v=1#a", ORIGIN)).toBe(true);
  });

  it("allows data:image URLs only", () => {
    expect(isAllowedImageUrl("data:image/png;base64,iVBORw0KGgo=", ORIGIN)).toBe(true);
    expect(isAllowedImageUrl("DATA:IMAGE/svg+xml,%3Csvg%2F%3E", ORIGIN)).toBe(true);
    expect(isAllowedImageUrl("data:text/html,<script>1</script>", ORIGIN)).toBe(false);
  });

  it("blocks remote http(s) URLs", () => {
    expect(isAllowedImageUrl("https://tracker.example.net/p.gif", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl("http://fm.example.com/a.png", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl("https://fm.example.com:8443/a.png", ORIGIN)).toBe(false);
  });

  it("treats protocol-relative URLs as remote", () => {
    expect(isAllowedImageUrl("//tracker.example.net/p.gif", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl("\\\\tracker.example.net/p.gif", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl("/\\tracker.example.net/p.gif", ORIGIN)).toBe(false);
  });

  it("blocks other schemes", () => {
    expect(isAllowedImageUrl("javascript:alert(1)", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl(" javascript:alert(1)", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl("ftp://fm.example.com/a.png", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl("blob:https://tracker.example.net/1", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl("file:///etc/passwd", ORIGIN)).toBe(false);
  });

  it("blocks malformed or empty URLs", () => {
    expect(isAllowedImageUrl("", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl("http://", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl("https://[bad/x.png", ORIGIN)).toBe(false);
  });

  it("blocks URLs the browser would parse as remote despite tabs or newlines", () => {
    expect(isAllowedImageUrl("ht\ttps://tracker.example.net/p.gif", ORIGIN)).toBe(false);
    expect(isAllowedImageUrl("/\n/tracker.example.net/p.gif", ORIGIN)).toBe(false);
  });

  it("keeps relative URLs but blocks absolute ones under an opaque origin", () => {
    expect(isAllowedImageUrl("x.png", "null")).toBe(true);
    expect(isAllowedImageUrl("https://fm.example.com/a.png", "null")).toBe(false);
  });
});

describe("isAllowedSrcset", () => {
  it("allows a srcset whose candidates are all allowed", () => {
    expect(isAllowedSrcset("a.png 1x, /b.png 2x", ORIGIN)).toBe(true);
    expect(isAllowedSrcset("data:image/png;base64,AA== 1x,https://fm.example.com/b.png 2x", ORIGIN)).toBe(true);
  });

  it("blocks a srcset with any remote candidate", () => {
    expect(isAllowedSrcset("a.png 1x, https://tracker.example.net/b.png 2x", ORIGIN)).toBe(false);
    expect(isAllowedSrcset("a.png,, //tracker.example.net/b.png", ORIGIN)).toBe(false);
    expect(isAllowedSrcset("https://tracker.example.net/b.png", ORIGIN)).toBe(false);
  });

  it("blocks an empty srcset", () => {
    expect(isAllowedSrcset(" , ", ORIGIN)).toBe(false);
  });
});
