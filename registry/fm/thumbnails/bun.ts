import type { FmThumbnailHook } from "../server/router";

/**
 * Thumbnails on Bun with the built-in `Bun.Image` (no dependency): WebP scaled to
 * the requested width. Images already that narrow, or that Bun cannot decode,
 * are declined so the UI shows the original.
 */
export function bunThumbnail(o: { quality?: number } = {}): FmThumbnailHook {
  return async (_c, { read, width }) => {
    const bytes = new Uint8Array(await new Response(await read()).arrayBuffer());
    try {
      const meta = await new Bun.Image(bytes).metadata();
      if (meta.width <= width)
        return undefined;
      const body = await new Bun.Image(bytes).resize(width).webp({ quality: o.quality ?? 80 }).bytes();
      return {
        body: new Blob([body as Uint8Array<ArrayBuffer>]),
        type: "image/webp",
      };
    }
    catch {
      return undefined;
    }
  };
}
