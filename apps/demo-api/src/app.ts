import type { Config } from "./config";
import type { Mount } from "@/fm/server/router";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { localDriver } from "@/fm/drivers/local";
import { memoryDriver } from "@/fm/drivers/memory";
import { s3Driver } from "@/fm/drivers/s3";
import { createFileManager } from "@/fm/server/router";
import { SEED } from "./seed";

export function createApp(config: Config) {
  const mounts: Mount[] = [
    {
      id: "local",
      label: "Local disk",
      driver: localDriver({ root: config.root }),
      trash: true,
    },
    {
      id: "scratch",
      label: "Scratch (memory)",
      driver: memoryDriver({
        files: Object.fromEntries(Object.entries(SEED).map(([k, v]) => [`/${k}`, v])),
      }),
      trash: true,
    },
    {
      id: "readonly",
      label: "Read-only view",
      driver: localDriver({ root: config.root }),
      readOnly: true,
      trash: true,
    },
  ];
  if (config.s3) {
    mounts.push({
      id: "s3",
      label: "S3 bucket",
      driver: s3Driver(config.s3),
      trash: true,
    });
  }

  const app = new Hono();
  app.route("/fm", createFileManager({
    mounts: () => mounts,
  }));
  app.get("/openapi.json", openAPIRouteHandler(app, {
    documentation: {
      openapi: "3.1.0",
      info: { title: "File manager demo API", version: "0.0.0" },
      servers: [
        { url: "/api" },
      ],
    },
    defaultValidationErrorResponse: false,
  }));
  app.get("/docs", c => c.redirect(`https://client.scalar.com/?url=${encodeURIComponent(new URL("/api/openapi.json", c.req.url).href)}`));
  app.onError((err, c) => {
    console.error(err);
    return c.json({
      error: { code: "INTERNAL", message: "Internal error" },
    }, 500);
  });
  return app;
}
