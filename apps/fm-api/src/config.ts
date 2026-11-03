import { resolve } from "node:path";
import { z } from "zod";

const optional = z.string().trim().transform(v => v || undefined).optional();

const schema = z.object({
  PORT: z.coerce.number().int().default(3010),
  FM_ROOT: optional,
  FM_STATIC: optional,
  FM_S3_ENDPOINT: optional,
  FM_S3_BUCKET: optional,
  FM_S3_ACCESS_KEY_ID: optional,
  FM_S3_SECRET_ACCESS_KEY: optional,
  FM_S3_REGION: z.string().default("us-east-1"),
  FM_UPLOAD_PART_SIZE: optional.pipe(z.coerce.number<string | undefined>().int().positive().optional()),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined>) {
  const c = schema.parse(env);
  const s3 = c.FM_S3_ENDPOINT && c.FM_S3_BUCKET && c.FM_S3_ACCESS_KEY_ID && c.FM_S3_SECRET_ACCESS_KEY
    ? {
        endpoint: c.FM_S3_ENDPOINT,
        bucket: c.FM_S3_BUCKET,
        accessKeyId: c.FM_S3_ACCESS_KEY_ID,
        secretAccessKey: c.FM_S3_SECRET_ACCESS_KEY,
        region: c.FM_S3_REGION,
      }
    : undefined;
  return {
    port: c.PORT,
    root: resolve(c.FM_ROOT ?? resolve(import.meta.dirname, "../../../.tmp/fm-root")),
    s3,
    /** Upload session part size in bytes (router default when unset). */
    uploadPartSize: c.FM_UPLOAD_PART_SIZE,
    /** Built SPA to serve next to `/api` (single-origin mode for e2e and previews). */
    staticDir: c.FM_STATIC
      ? resolve(c.FM_STATIC)
      : undefined,
  };
}
