import type { Context, Env } from "hono";
import type { FmThumbnailHook } from "../server/router";

/** The part of Cloudflare's Images binding (`env.IMAGES`) the hook uses. */
export interface FmImagesBinding {
  info: (stream: ReadableStream<Uint8Array>) => Promise<{ format: string; width?: number }>;
  input: (stream: ReadableStream<Uint8Array>) => {
    transform: (t: { width: number; fit?: "scale-down" }) => {
      output: (o: { format: "image/webp"; quality?: number }) => Promise<{
        image: () => ReadableStream<Uint8Array>;
        contentType: () => string;
      }>;
    };
  };
}

/**
 * Thumbnails on Cloudflare Workers with the Images binding: WebP scaled to the
 * requested width. Narrow images and inputs the binding rejects are declined.
 */
export function cloudflareThumbnail<E extends Env = Env>(images: (c: Context<E>) => FmImagesBinding, o: { quality?: number } = {}): FmThumbnailHook<E> {
  return async (c, { read, width }) => {
    const binding = images(c);
    try {
      const info = await binding.info(await read());
      if (info.width === undefined || info.width <= width)
        return undefined;
      const out = await binding.input(await read()).transform({ width, fit: "scale-down" }).output({ format: "image/webp", quality: o.quality ?? 80 });
      return {
        body: out.image(),
        type: out.contentType(),
      };
    }
    catch {
      return undefined;
    }
  };
}
