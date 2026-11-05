import { describe, expect, it } from "bun:test";
import { bunThumbnail } from "./bun";

async function image(width: number, height: number) {
  // 1x1 PNG scaled to the wanted size.
  const dot = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), ch => ch.charCodeAt(0));
  return new Bun.Image(dot).resize(width, height).png().bytes();
}
function input(bytes: Uint8Array, width: 128 | 256 | 512) {
  return {
    entry: {
      name: "a.png",
      kind: "file" as const,
      size: bytes.length,
      mtime: 0,
      etag: "e",
      path: "/a.png",
    },
    width,
    read: async () => new Blob([bytes as Uint8Array<ArrayBuffer>]).stream(),
  };
}

describe("bunThumbnail", () => {
  const thumb = bunThumbnail();
  it("scales down to the width as WebP, keeping the aspect ratio", async () => {
    const out = await thumb({} as never, input(await image(600, 300), 256));
    expect(out?.type).toBe("image/webp");
    const meta = await new Bun.Image(new Uint8Array(await new Response(out!.body).arrayBuffer())).metadata();
    expect(meta).toMatchObject({ width: 256, height: 128, format: "webp" });
  });
  it("declines images already within the width and unreadable data", async () => {
    expect(await thumb({} as never, input(await image(100, 50), 256))).toBeUndefined();
    expect(await thumb({} as never, input(new Uint8Array([1, 2, 3]), 128))).toBeUndefined();
  });
});
