import process from "node:process";
import { serveStatic } from "@hono/bun";
import { Hono } from "hono";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { seedIfEmpty } from "./seed";

async function main() {
  const config = loadConfig(process.env);
  await seedIfEmpty(config.root);

  const api = createApp(config);
  let fetch = api.fetch;
  if (config.staticDir) {
    // Without nsl stripping `/api`, mount the API under it and serve the SPA beside it.
    const root = new Hono();
    root.route("/api", api);
    root.use("/*", serveStatic({ root: config.staticDir }));
    root.get("*", serveStatic({ path: `${config.staticDir}/index.html` }));
    fetch = root.fetch;
  }

  const server = Bun.serve({ port: config.port, fetch });
  process.stdout.write(`fm-api listening on ${server.url} (root: ${config.root})\n`);
}

void main();
