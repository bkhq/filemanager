import type { Config } from "./config";
import type { FmDriver, FmDriverEntry } from "@/fm/server/driver";
import type { FmMount } from "@/fm/server/router";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { isWithin } from "@/fm/core/path";
import { localDriver } from "@/fm/drivers/local";
import { memoryDriver } from "@/fm/drivers/memory";
import { s3Driver } from "@/fm/drivers/s3";
import { createFmRouter } from "@/fm/server/router";
import { bunThumbnail } from "@/fm/thumbnails/bun";
import { SEED } from "./seed";

/** Adds `extra.owner` to the entries of a driver, as a host would from its own records. */
function withOwners(driver: FmDriver, owners: Record<string, string>): FmDriver {
  const tag = <T extends { path: string }>(e: T) => (owners[e.path]
    ? {
        ...e,
        extra: { owner: owners[e.path]! },
      }
    : e);
  return {
    ...driver,
    stat: async path => tag(await driver.stat(path)),
    list: async path => (await driver.list(path)).map(tag),
  };
}

const DAY_MS = 86_400_000;

/**
 * A memory driver dressed as a database-backed drive (bithk style): stable entry ids that
 * survive renames and moves, owners kept by id, and its own trash with a 14-day expiry.
 */
function teamDrive(): FmDriver {
  const base = memoryDriver({
    files: {
      "/brief.md": "# Brief\n\nKick-off notes.\n",
      "/notes.txt": "Agenda\n",
      "/specs/api.md": "# API\n",
    },
    nativeTrash: true,
  });
  const ids = new Map<string, string>();
  const owners = new Map<string, string>();
  // Original path of each trashed entry, so a restore gives back its ids.
  const trashed = new Map<string, string>();
  const idOf = (path: string) => {
    let id = ids.get(path);
    if (!id) {
      id = `e_${crypto.randomUUID().slice(0, 8)}`;
      ids.set(path, id);
    }
    return id;
  };
  for (const [path, owner] of [
    ["/brief.md", "Ada"],
    ["/specs", "Bo"],
  ] as const)
    owners.set(idOf(path), owner);
  const dress = <T extends FmDriverEntry>(e: T): T => {
    const id = idOf(e.path);
    return {
      ...e,
      id,
      extra: { owner: owners.get(id) ?? "You" },
    };
  };
  // Ids follow the entries they belong to.
  const follow = (from: string, to: string) => {
    for (const [p, id] of [...ids]) {
      if (isWithin(p, from)) {
        ids.delete(p);
        ids.set(to + p.slice(from.length), id);
      }
    }
  };
  const trash = base.trash!;
  return {
    ...base,
    stat: async path => dress(await base.stat(path)),
    list: async path => (await base.list(path)).map(dress),
    write: async (path, body, o) => dress(await base.write(path, body, o)),
    mkdir: async (path, ctx) => dress(await base.mkdir(path, ctx)),
    copy: async (from, to, ctx) => dress(await base.copy(from, to, ctx)),
    async move(from, to, ctx) {
      const e = await base.move(from, to, ctx);
      follow(from, to);
      return dress(e);
    },
    trash: {
      ...trash,
      list: async () => (await trash.list()).map(i => ({ ...i, expiresAt: i.deletedAt + 14 * DAY_MS })),
      async get(id) {
        const item = await trash.get(id);
        return { ...item, expiresAt: item.deletedAt + 14 * DAY_MS };
      },
      async remove(path, ctx) {
        const id = await trash.remove(path, ctx);
        trashed.set(id, path);
        return id;
      },
      async restore(id, to, ctx) {
        const e = await trash.restore(id, to, ctx);
        follow(trashed.get(id) ?? to, to);
        return dress(e);
      },
    },
  };
}

export function createApp(config: Config) {
  const mounts: FmMount[] = [
    {
      id: "local",
      label: "Local disk",
      // Review demo: run `git init` (and commit) in the root to see changes.
      driver: localDriver({ root: config.root, gitChanges: true }),
      absoluteRoot: config.root,
      trash: { retentionDays: 30 },
      // Drive demo: a space group and a usage figure, as a host would resolve per user.
      group: "Personal",
      quota: { used: 3_400_000, total: 10 * 1024 ** 3 },
    },
    {
      id: "scratch",
      label: "Scratch (memory)",
      driver: memoryDriver({
        files: Object.fromEntries(Object.entries(SEED).map(([k, v]) => [`/${k}`, v])),
        // Shows a driver-kept trash (`FmDriver.trash`); Local disk uses the router's folder.
        nativeTrash: true,
      }),
      trash: true,
      group: "Personal",
    },
    {
      id: "shared",
      label: "Team plans",
      group: "Shared with me",
      driver: withOwners(memoryDriver({
        files: {
          "/roadmap.md": "# Roadmap\n\n- Q1: drive view\n",
          "/budget.csv": "item,amount\nservers,1200\n",
          "/designs/logo.txt": "logo placeholder\n",
        },
      }), { "/roadmap.md": "Ada", "/budget.csv": "Bo", "/designs": "Ada" }),
      readOnly: true,
    },
    {
      id: "team",
      label: "Team drive",
      group: "Team",
      driver: teamDrive(),
      trash: true,
      quota: { used: 820_000, total: 5 * 1024 ** 3 },
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
  app.route("/fm", createFmRouter({
    mounts: () => mounts,
    thumbnail: bunThumbnail(),
    // Shows change notes (X-Fm-Message) in the dev log; a real host would store them (commits, audit).
    onEvent: (_c, e) => {
      if (e.message) {
        console.warn(`[fm] ${e.op} ${e.mount}:${e.path}${e.to
          ? ` -> ${e.to}`
          : ""} — ${e.message}`);
      }
    },
    ...(config.uploadPartSize
      ? {
          limits: { uploadPartSize: config.uploadPartSize },
        }
      : {}),
  }));
  app.get("/openapi.json", openAPIRouteHandler(app, {
    documentation: {
      openapi: "3.1.0",
      info: { title: "File manager API", version: "0.0.0" },
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
