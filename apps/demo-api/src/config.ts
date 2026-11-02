import { resolve } from "node:path";
import { z } from "zod";

const optional = z.string().trim().transform(v => v || undefined).optional();

const schema = z.object({
  PORT: z.coerce.number().int().default(3010),
  FM_DEMO_ROOT: optional,
  FM_DEMO_STATIC: optional,
  FM_DEMO_S3_ENDPOINT: optional,
  FM_DEMO_S3_BUCKET: optional,
  FM_DEMO_S3_ACCESS_KEY_ID: optional,
  FM_DEMO_S3_SECRET_ACCESS_KEY: optional,
  FM_DEMO_S3_REGION: z.string().default("us-east-1"),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined>) {
  const c = schema.parse(env);
  const s3 = c.FM_DEMO_S3_ENDPOINT && c.FM_DEMO_S3_BUCKET && c.FM_DEMO_S3_ACCESS_KEY_ID && c.FM_DEMO_S3_SECRET_ACCESS_KEY
    ? {
        endpoint: c.FM_DEMO_S3_ENDPOINT,
        bucket: c.FM_DEMO_S3_BUCKET,
        accessKeyId: c.FM_DEMO_S3_ACCESS_KEY_ID,
        secretAccessKey: c.FM_DEMO_S3_SECRET_ACCESS_KEY,
        region: c.FM_DEMO_S3_REGION,
      }
    : undefined;
  return {
    port: c.PORT,
    root: resolve(c.FM_DEMO_ROOT ?? resolve(import.meta.dirname, "../../../.tmp/demo-root")),
    s3,
    /** Built SPA to serve next to `/api` (single-origin mode for e2e and previews). */
    staticDir: c.FM_DEMO_STATIC
      ? resolve(c.FM_DEMO_STATIC)
      : undefined,
  };
}
