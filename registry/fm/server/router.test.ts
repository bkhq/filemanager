import type { Env } from "hono";
import type { FmCaps } from "../core/schema";
import type { FmDriver } from "./driver";
import type { FmChangeEvent, FmMount, FmRouterOptions } from "./router";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { Hono } from "hono";
import { FmError } from "../core/errors";
import { ALL_CAPS, READ_ONLY_CAPS } from "../core/schema";
import { localDriver } from "../drivers/local";
import { memoryDriver } from "../drivers/memory";
import { readAll } from "./driver";
import { createFmRouter, purgeExpired } from "./router";

const NONE: FmCaps = {
  read: false,
  write: false,
  delete: false,
  rename: false,
  move: false,
  copy: false,
};

function setup(opts: { files?: Record<string, string>; mounts?: FmMount[]; authorize?: (path: string) => FmCaps; maxUploadBytes?: number; onEvent?: FmRouterOptions<Env>["onEvent"]; limits?: FmRouterOptions<Env>["limits"]; thumbnail?: FmRouterOptions<Env>["thumbnail"] } = {}) {
  const driver = memoryDriver({ files: opts.files ?? {} });
  const mounts = opts.mounts ?? [
    { id: "m", label: "Main", driver },
  ];
  const app = new Hono();
  app.route("/fm", createFmRouter({
    mounts: () => mounts,
    ...(opts.authorize
      ? {
          authorize: (_c, t) => opts.authorize!(t.path),
        }
      : {}),
    ...(opts.onEvent
      ? { onEvent: opts.onEvent }
      : {}),
    ...(opts.thumbnail
      ? { thumbnail: opts.thumbnail }
      : {}),
    limits: { maxUploadBytes: opts.maxUploadBytes ?? 1024, archiveMaxEntries: 10, ...opts.limits },
  }));
  app.onError((_e, c) => c.json({ host: true }, 500));
  const req = (path: string, init?: RequestInit) => app.request(`/fm${path}`, init);
  const json = (method: string, path: string, body: unknown) =>
    req(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { app, driver, req, json };
}

const q = (path: string) => encodeURIComponent(path);

describe("mounts and access", () => {
  it("lists mount groups and quotas when the host sets them", async () => {
    const { req } = setup({
      mounts: [
        {
          id: "me",
          label: "Mine",
          driver: memoryDriver(),
          group: "Personal",
          quota: { used: 1024, total: 4096 },
        },
        {
          id: "team",
          label: "Team",
          driver: memoryDriver(),
          group: "Teams",
          quota: { used: 7 },
        },
        {
          id: "plain",
          label: "Plain",
          driver: memoryDriver(),
        },
      ],
    });
    const { mounts } = await (await req("/mounts")).json();
    expect(mounts[0]).toMatchObject({
      group: "Personal",
      quota: { used: 1024, total: 4096 },
    });
    expect(mounts[1]).toMatchObject({
      group: "Teams",
      quota: { used: 7 },
    });
    expect("total" in mounts[1].quota).toBe(false);
    expect("group" in mounts[2] || "quota" in mounts[2]).toBe(false);
  });

  it("lists mounts with caps and hides unreadable ones", async () => {
    const { req } = setup({
      mounts: [
        {
          id: "a",
          label: "A",
          driver: memoryDriver(),
        },
        {
          id: "b",
          label: "B",
          driver: memoryDriver(),
          readOnly: true,
        },
      ],
    });
    const body = await (await req("/mounts")).json();
    expect(body.mounts).toEqual([
      expect.objectContaining({
        id: "a",
        driver: "memory",
        caps: expect.objectContaining({ write: true }),
      }),
      expect.objectContaining({ id: "b", caps: READ_ONLY_CAPS }),
    ]);
  });

  it("answers 404 for unknown mounts and unreadable paths, 403 for denied writes", async () => {
    const { req, json } = setup({
      files: { "/secret/x.txt": "x", "/pub/y.txt": "y" },
      authorize: p => (p.startsWith("/secret")
        ? NONE
        : READ_ONLY_CAPS),
    });
    expect((await req("/m/nope/stat?path=/")).status).toBe(404);
    expect((await req(`/m/m/stat?path=${q("/secret/x.txt")}`)).status).toBe(404);
    expect((await req(`/m/m/stat?path=${q("/pub/y.txt")}`)).status).toBe(200);
    expect((await json("POST", "/m/m/mkdir", { path: "/pub/new" })).status).toBe(403);
  });

  it("rejects traversal and invalid input", async () => {
    const { req, json } = setup();
    expect((await req(`/m/m/stat?path=${q("/../etc")}`)).status).toBe(400);
    expect((await json("POST", "/m/m/mkdir", { nope: 1 })).status).toBe(422);
  });

  it("lets non-file-manager errors reach the host", async () => {
    const broken: FmDriver = {
      ...memoryDriver(),
      stat: async () => {
        throw new Error("boom");
      },
    };
    const { req } = setup({
      mounts: [
        { id: "m", label: "M", driver: broken },
      ],
    });
    const res = await req("/m/m/stat?path=/");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ host: true });
  });
});

describe("list", () => {
  it("sorts directories first and pages with a cursor", async () => {
    const { req } = setup({
      files: {
        "/b.txt": "bb",
        "/a10.txt": "a",
        "/a2.txt": "aaa",
        "/z/x": "x",
      },
    });
    const page1 = await (await req("/m/m/list?path=/&limit=3")).json();
    expect(page1.items.map((e: { name: string }) => e.name)).toEqual(["z", "a2.txt", "a10.txt"]);
    expect(page1).toMatchObject({
      total: 4,
      cursor: "3",
      entry: { kind: "dir" },
    });
    const page2 = await (await req("/m/m/list?path=/&limit=3&cursor=3")).json();
    expect(page2.items.map((e: { name: string }) => e.name)).toEqual(["b.txt"]);
    expect(page2.cursor).toBeUndefined();
    const bySize = await (await req("/m/m/list?path=/&sort=size&order=desc")).json();
    expect(bySize.items.map((e: { name: string }) => e.name)).toEqual(["z", "a2.txt", "b.txt", "a10.txt"]);
  });

  it("filters by name", async () => {
    const { req } = setup({
      files: { "/Report.pdf": "r", "/notes/a.txt": "a", "/b.txt": "b" },
    });
    const body = await (await req("/m/m/list?path=/&q=RE")).json();
    expect(body.items.map((e: { name: string }) => e.name)).toEqual(["Report.pdf"]);
    expect(body.total).toBe(1);
  });

  it("drops dot entries with hidden=0", async () => {
    const { req } = setup({
      files: { "/.env": "e", "/.git/HEAD": "h", "/a.txt": "a" },
    });
    const all = await (await req("/m/m/list?path=/")).json();
    expect(all.items.map((e: { name: string }) => e.name)).toEqual([".git", ".env", "a.txt"]);
    expect(all.total).toBe(3);
    const shown = await (await req("/m/m/list?path=/&hidden=0")).json();
    expect(shown.items.map((e: { name: string }) => e.name)).toEqual(["a.txt"]);
    expect(shown.total).toBe(1);
  });

  it("passes subfolder hints through and leaves them out when unknown", async () => {
    const { req } = setup({
      files: { "/files/a.txt": "a", "/nested/deep/b.txt": "b" },
    });
    const list = await (await req("/m/m/list?path=/")).json();
    const by = Object.fromEntries(list.items.map((e: { name: string; hasSubfolders?: boolean }) => [e.name, e.hasSubfolders]));
    expect(by).toEqual({ files: false, nested: true });
    expect((await (await req("/m/m/stat?path=/nested")).json()).hasSubfolders).toBe(true);
    const base = memoryDriver({
      files: { "/x/y.txt": "y" },
    });
    const driver: FmDriver = {
      ...base,
      list: async path => (await base.list(path)).map(({ hasSubfolders: _, ...e }) => e),
    };
    const plain = await (await setup({
      mounts: [
        { id: "m", label: "M", driver },
      ],
    }).req("/m/m/list?path=/")).json();
    expect("hasSubfolders" in plain.items[0]).toBe(false);
  });

  it("passes driver ids and extra fields through list, stat and search", async () => {
    const base = memoryDriver({
      files: { "/a.txt": "a", "/b.txt": "b" },
    });
    const tag = <T extends { path: string }>(e: T) => (e.path === "/a.txt"
      ? {
          ...e,
          id: "id-a",
          extra: {
            owner: "ada",
            shared: true,
            size: 1,
            note: null,
          },
        }
      : e);
    const driver: FmDriver = {
      ...base,
      stat: async path => tag(await base.stat(path)),
      list: async path => (await base.list(path)).map(tag),
    };
    const { req } = setup({
      mounts: [
        { id: "m", label: "M", driver },
      ],
    });
    const list = await (await req("/m/m/list?path=/")).json();
    expect(list.items[0]).toMatchObject({
      name: "a.txt",
      id: "id-a",
      extra: {
        owner: "ada",
        shared: true,
        size: 1,
        note: null,
      },
    });
    expect("id" in list.items[1]).toBe(false);
    expect("extra" in list.items[1]).toBe(false);
    expect(await (await req("/m/m/stat?path=/a.txt")).json()).toMatchObject({
      id: "id-a",
      extra: { owner: "ada" },
    });
    const found = await (await req("/m/m/search?path=/&q=a.txt")).json();
    expect(found.items[0]).toMatchObject({ id: "id-a" });
  });

  it("flags, counts and drops ignored entries", async () => {
    const base = memoryDriver({
      files: { "/dist/x.js": "x", "/a.txt": "a", "/b.log": "b" },
    });
    const driver: FmDriver = {
      ...base,
      list: async path => (await base.list(path)).map(e => (e.name === "dist" || e.name === "b.log"
        ? { ...e, ignored: true }
        : e)),
    };
    const { req } = setup({
      mounts: [
        { id: "m", label: "M", driver },
      ],
    });
    const all = await (await req("/m/m/list?path=/")).json();
    expect(all.items.map((e: { name: string; ignored?: boolean }) => [e.name, e.ignored])).toEqual([
      ["dist", true],
      ["a.txt", undefined],
      ["b.log", true],
    ]);
    expect("ignored" in all.items[1]).toBe(false);
    expect(all).toMatchObject({ total: 3, ignored: 2 });
    const kept = await (await req("/m/m/list?path=/&ignored=0")).json();
    expect(kept.items.map((e: { name: string }) => e.name)).toEqual(["a.txt"]);
    expect(kept).toMatchObject({ total: 1, ignored: 2 });
    const plain = await (await setup({
      files: { "/a.txt": "a" },
    }).req("/m/m/list?path=/")).json();
    expect("ignored" in plain).toBe(false);
  });

  it("refuses to list a file", async () => {
    const { req } = setup({
      files: { "/a.txt": "a" },
    });
    expect((await req("/m/m/list?path=/a.txt")).status).toBe(400);
  });
});

describe("read", () => {
  it("serves safe types inline and downgrades script-capable ones", async () => {
    const { req } = setup({
      files: { "/p.png": "png", "/x.html": "<script>", "/b.bin": "?" },
    });
    const png = await req("/m/m/read?path=/p.png");
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("content-disposition")).toStartWith("inline");
    const html = await req("/m/m/read?path=/x.html");
    expect(html.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    const bin = await req("/m/m/read?path=/b.bin");
    expect(bin.headers.get("content-type")).toBe("application/octet-stream");
    expect(bin.headers.get("content-disposition")).toStartWith("attachment");
    const dl = await req("/m/m/read?path=/p.png&download=1");
    expect(dl.headers.get("content-disposition")).toStartWith("attachment");
  });

  it("serves SVG as an image inside the sandbox CSP", async () => {
    const { req } = setup({
      files: { "/i.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>" },
    });
    const svg = await req("/m/m/read?path=/i.svg");
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg.headers.get("content-security-policy")).toContain("sandbox");
    expect(svg.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("supports ranges, etags and 304", async () => {
    const { req } = setup({
      files: { "/r.txt": "0123456789" },
    });
    const part = await req("/m/m/read?path=/r.txt", {
      headers: { range: "bytes=2-4" },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await part.text()).toBe("234");
    const suffix = await req("/m/m/read?path=/r.txt", {
      headers: { range: "bytes=-3" },
    });
    expect(await suffix.text()).toBe("789");
    expect((await req("/m/m/read?path=/r.txt", {
      headers: { range: "bytes=20-" },
    })).status).toBe(416);
    const full = await req("/m/m/read?path=/r.txt");
    const etag = full.headers.get("etag")!;
    expect((await req("/m/m/read?path=/r.txt", {
      headers: { "if-none-match": etag },
    })).status).toBe(304);
    expect((await req("/m/m/read?path=/")).status).toBe(400);
  });
});

describe("write", () => {
  it("writes, renames on conflict and enforces fail / If-Match / size", async () => {
    const { req, driver } = setup({ maxUploadBytes: 8 });
    const put = (path: string, body: string, headers: Record<string, string> = {}, conflict = "") =>
      req(`/m/m/write?path=${q(path)}${conflict
        ? `&conflict=${conflict}`
        : ""}`, { method: "PUT", body, headers });

    const first = await (await put("/d/a.txt", "one")).json();
    expect(first).toMatchObject({ path: "/d/a.txt", size: 3, mime: "text/plain" });
    expect((await (await put("/d/a.txt", "two", {}, "rename")).json()).path).toBe("/d/a (1).txt");
    expect((await put("/d/a.txt", "x", {}, "fail")).status).toBe(409);
    expect((await put("/d/a.txt", "x", { "if-match": "\"stale\"" })).status).toBe(412);
    expect((await put("/d/a.txt", "three", { "if-match": `"${first.etag}"` })).status).toBe(200);
    expect((await put("/d/big.txt", "123456789")).status).toBe(413);
    await expect(driver.stat("/d/big.txt")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("mkdir and ops", () => {
  it("creates directories", async () => {
    const { json } = setup();
    const res = await json("POST", "/m/m/mkdir", { path: "/new" });
    expect(res.status).toBe(201);
    expect((await json("POST", "/m/m/mkdir", { path: "/new" })).status).toBe(409);
  });

  it("deletes, renames, moves and copies with per-item results", async () => {
    const { json, driver } = setup({
      files: {
        "/a.txt": "a",
        "/b.txt": "b",
        "/dst/a.txt": "old",
        "/dir/c.txt": "c",
      },
    });
    const ops = async (body: unknown) => (await (await json("POST", "/m/m/ops", body)).json()).results;

    expect(await ops({
      op: "delete",
      paths: ["/b.txt", "/missing"],
    })).toEqual([
      { path: "/b.txt", ok: true },
      {
        path: "/missing",
        ok: false,
        error: expect.objectContaining({ code: "NOT_FOUND" }),
      },
    ]);
    expect((await ops({ op: "rename", path: "/dir", name: "folder" }))[0].entry.path).toBe("/folder");
    expect((await ops({
      op: "copy",
      paths: ["/a.txt"],
      dest: "/dst",
      conflict: "rename",
    }))[0].entry.path).toBe("/dst/a (1).txt");
    expect((await ops({
      op: "move",
      paths: ["/a.txt"],
      dest: "/dst",
    }))[0].error.code).toBe("EXISTS");
    expect((await ops({
      op: "move",
      paths: ["/a.txt"],
      dest: "/dst",
      conflict: "overwrite",
    }))[0].ok).toBe(true);
    expect((await driver.stat("/dst/a.txt")).size).toBe(1);
    expect((await ops({
      op: "move",
      paths: ["/folder"],
      dest: "/folder",
    }))[0].error.code).toBe("INVALID");
    expect((await ops({
      op: "copy",
      paths: ["/dst/a.txt"],
      dest: "/dst",
    }))[0].entry.path).toBe("/dst/a (2).txt");
    expect((await ops({
      op: "move",
      paths: ["/dst/a.txt"],
      dest: "/dst",
    }))[0].ok).toBe(true);
    expect((await ops({
      op: "delete",
      paths: ["/"],
    }))[0].error.code).toBe("INVALID");
  });

  it("authorizes rename targets and overwritten entries", async () => {
    const { json, driver } = setup({
      files: {
        "/a.txt": "a",
        "/sub/x": "x",
        "/locked/a.txt": "keep",
        "/locked/b.txt": "b",
      },
      authorize: p => (p === "/locked/a.txt" || p === "/secret.txt"
        ? READ_ONLY_CAPS
        : {
            ...NONE,
            read: true,
            write: true,
            rename: true,
            move: true,
            copy: true,
            delete: true,
          }),
    });
    const ops = async (body: unknown) => (await (await json("POST", "/m/m/ops", body)).json()).results;

    expect((await ops({ op: "rename", path: "/a.txt", name: "sub/a.txt" }))[0].error.code).toBe("INVALID");
    expect((await ops({ op: "rename", path: "/a.txt", name: "secret.txt" }))[0].error.code).toBe("FORBIDDEN");
    expect((await ops({
      op: "move",
      paths: ["/locked/b.txt"],
      dest: "/locked",
      conflict: "overwrite",
    }))[0].ok).toBe(true);
    expect((await ops({
      op: "copy",
      paths: ["/a.txt"],
      dest: "/locked",
      conflict: "overwrite",
    }))[0].error.code).toBe("FORBIDDEN");
    expect(new TextDecoder().decode(await new Response((await driver.read("/locked/a.txt")).body).arrayBuffer())).toBe("keep");
  });
});

describe("archive", () => {
  it("streams a zip of files and folders", async () => {
    const { req } = setup({
      files: { "/d/a.txt": "a", "/d/s/b.txt": "bb", "/c.txt": "c" },
    });
    const res = await req(`/m/m/archive?path=${q("/d")}&path=${q("/c.txt")}`);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "c.txt",
      "d/",
      "d/a.txt",
      "d/s/",
      "d/s/b.txt",
    ]);
    expect(new TextDecoder().decode(files["d/s/b.txt"])).toBe("bb");
  });

  it("fails before streaming when over the entry cap", async () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/many/${i}.txt`, "x"]));
    const { req } = setup({ files });
    expect((await req("/m/m/archive?path=/many")).status).toBe(413);
  });
});

describe("usage", () => {
  it("sums a folder and flags truncated walks", async () => {
    const { req } = setup({
      files: { "/d/a.txt": "aa", "/d/s/b.txt": "bbb", "/c.txt": "c" },
    });
    expect(await (await req("/m/m/usage?path=/d")).json()).toEqual({
      bytes: 5,
      files: 2,
      dirs: 1,
      truncated: false,
    });
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/many/${i}.txt`, "x"]));
    const big = setup({ files });
    expect((await (await big.req("/m/m/usage?path=/many")).json()).truncated).toBe(true);
  });
});

describe("search", () => {
  const names = (body: { items: { path: string }[] }) => body.items.map(e => e.path);

  it("finds matches in nested folders, excluding the folder itself", async () => {
    const { req } = setup({
      files: {
        "/a/Report.txt": "r",
        "/a/b/c/report-2.md": "r",
        "/a/b/other.txt": "o",
        "/report.txt": "outside",
      },
    });
    const res = await req(`/m/m/search?path=/a&q=${q("REPORT")}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(names(body)).toEqual(["/a/Report.txt", "/a/b/c/report-2.md"]);
    expect(body.truncated).toBe(false);
    expect(body.items[1]).toMatchObject({ mount: "m", name: "report-2.md", kind: "file" });
  });

  it("skips the trash", async () => {
    const driver = memoryDriver({
      files: { "/keep-needle.txt": "k", "/d/gone-needle.txt": "g" },
    });
    const { req, json } = setup({
      mounts: [
        {
          id: "m",
          label: "Main",
          driver,
          trash: true,
        },
      ],
    });
    await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/d/gone-needle.txt"],
    });
    const body = await (await req("/m/m/search?path=/&q=needle")).json();
    expect(names(body)).toEqual(["/keep-needle.txt"]);
  });

  it("hides unauthorized subtrees and gives each hit its own caps", async () => {
    const { req } = setup({
      files: {
        "/secret/x-needle.txt": "x",
        "/secret/deep/y-needle.txt": "y",
        "/pub/z-needle.txt": "z",
        "/w-needle.txt": "w",
      },
      authorize: p => (p.startsWith("/secret")
        ? NONE
        : (p.startsWith("/pub")
            ? READ_ONLY_CAPS
            : { ...READ_ONLY_CAPS, write: true })),
    });
    const body = await (await req("/m/m/search?path=/&q=needle")).json();
    expect(names(body)).toEqual(["/w-needle.txt", "/pub/z-needle.txt"]);
    expect(body.items[0].caps.write).toBe(true);
    expect(body.items[1].caps).toEqual(READ_ONLY_CAPS);
  });

  it("flags truncated results at the visit budget and the hit limit", async () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/many/${i}.txt`, "x"]));
    const big = setup({ files });
    const budget = await (await big.req("/m/m/search?path=/many&q=nomatch")).json();
    expect(budget).toEqual({ items: [], truncated: true });

    const { req } = setup({
      files: { "/a1.txt": "a", "/a2.txt": "a", "/a3.txt": "a" },
    });
    const cut = await (await req("/m/m/search?path=/&q=a&limit=2")).json();
    expect(cut.items).toHaveLength(2);
    expect(cut.truncated).toBe(true);
    const all = await (await req("/m/m/search?path=/&q=a&limit=3")).json();
    expect(all.items).toHaveLength(3);
    expect(all.truncated).toBe(false);
  });

  it("prefers the driver search and falls back to the walk on null", async () => {
    const base = memoryDriver({
      files: { "/d/needle.txt": "n" },
    });
    const calls: string[] = [];
    let answer: "sentinel" | "null" = "sentinel";
    const driver: FmDriver = {
      ...base,
      list: async (path) => {
        calls.push(path);
        return base.list(path);
      },
      search: async (_dir, _q, opts) => {
        expect(opts.limit).toBe(5);
        expect(opts.signal).toBeInstanceOf(AbortSignal);
        return answer === "null"
          ? null
          : [
              {
                path: "/sentinel.bin",
                name: "sentinel.bin",
                kind: "file",
                size: 1,
                mtime: 0,
                etag: "s",
              },
            ];
      },
    };
    const { req } = setup({
      mounts: [
        { id: "m", label: "M", driver },
      ],
    });
    const fromDriver = await (await req("/m/m/search?path=/&q=needle&limit=5")).json();
    expect(names(fromDriver)).toEqual(["/sentinel.bin"]);
    expect(fromDriver.truncated).toBe(false);
    expect(calls).toEqual([]);

    answer = "null";
    const walked = await (await req("/m/m/search?path=/&q=needle&limit=5")).json();
    expect(names(walked)).toEqual(["/d/needle.txt"]);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("drops results below dot folders and ignored entries on request", async () => {
    const base = memoryDriver({
      files: { "/.cache/needle.txt": "n", "/src/needle.ts": "n", "/out/needle.js": "n" },
    });
    const driver: FmDriver = {
      ...base,
      list: async path => (await base.list(path)).map(e => (e.path === "/out"
        ? { ...e, ignored: true }
        : e)),
    };
    const { req } = setup({
      mounts: [
        { id: "m", label: "M", driver },
      ],
    });
    const all = await (await req("/m/m/search?path=/&q=needle")).json();
    expect(names(all).sort()).toEqual(["/.cache/needle.txt", "/out/needle.js", "/src/needle.ts"]);
    const visible = await (await req("/m/m/search?path=/&q=needle&hidden=0")).json();
    expect(names(visible).sort()).toEqual(["/out/needle.js", "/src/needle.ts"]);
    const kept = await (await req("/m/m/search?path=/&q=needle&hidden=0&ignored=0")).json();
    expect(names(kept)).toEqual(["/src/needle.ts"]);
    const fuzzy = await (await req("/m/m/search?path=/&q=needle&mode=fuzzy&hidden=0")).json();
    expect(names(fuzzy).sort()).toEqual(["/out/needle.js", "/src/needle.ts"]);
  });

  it("filters driver search results with hidden=0 and ignored=0", async () => {
    const entry = (path: string, ignored?: boolean) => ({
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      kind: "file" as const,
      size: 1,
      mtime: 0,
      etag: path,
      ...(ignored
        ? { ignored }
        : {}),
    });
    const driver: FmDriver = {
      ...memoryDriver(),
      search: async () => [
        entry("/.git/needle"),
        entry("/a/needle"),
        entry("/b/needle", true),
      ],
    };
    const { req } = setup({
      mounts: [
        { id: "m", label: "M", driver },
      ],
    });
    const body = await (await req("/m/m/search?path=/&q=needle&hidden=0&ignored=0")).json();
    expect(names(body)).toEqual(["/a/needle"]);
    const all = await (await req("/m/m/search?path=/&q=needle")).json();
    expect(names(all)).toEqual(["/.git/needle", "/a/needle", "/b/needle"]);
    expect(all.items[2].ignored).toBe(true);
  });

  it("refuses files and empty queries", async () => {
    const { req } = setup({
      files: { "/a.txt": "a" },
    });
    const res = await req(`/m/m/search?path=${q("/a.txt")}&q=a`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("NOT_A_DIR");
    expect((await req("/m/m/search?path=/&q=%20")).status).toBe(422);
  });

  describe("fuzzy mode", () => {
    it("ranks basename matches first and matches across folders", async () => {
      const { req } = setup({
        files: {
          "/docs/maintenance.md": "d",
          "/src/main.ts": "s",
          "/src/lib/util.ts": "u",
        },
      });
      const body = await (await req("/m/m/search?path=/&q=main&mode=fuzzy")).json();
      expect(names(body)).toEqual(["/src/main.ts", "/docs/maintenance.md"]);
      expect(body.truncated).toBe(false);
      const across = await (await req("/m/m/search?path=/&q=srcmain&mode=fuzzy")).json();
      expect(names(across)).toEqual(["/src/main.ts"]);
    });

    it("scores the path below the searched folder", async () => {
      const { req } = setup({
        files: { "/a/b/c.ts": "c" },
      });
      expect(names(await (await req("/m/m/search?path=/a&q=bc&mode=fuzzy")).json())).toEqual(["/a/b/c.ts"]);
      expect(names(await (await req("/m/m/search?path=/a&q=ab&mode=fuzzy")).json())).toEqual([]);
    });

    it("respects authorize and the trash", async () => {
      const driver = memoryDriver({
        files: {
          "/secret/needle.txt": "x",
          "/pub/needle.txt": "p",
          "/d/needle-gone.txt": "g",
        },
      });
      const { req, json } = setup({
        mounts: [
          {
            id: "m",
            label: "Main",
            driver,
            trash: true,
          },
        ],
        authorize: p => (p.startsWith("/secret")
          ? NONE
          : (p.startsWith("/pub")
              ? READ_ONLY_CAPS
              : ALL_CAPS)),
      });
      await json("POST", "/m/m/ops", {
        op: "delete",
        paths: ["/d/needle-gone.txt"],
      });
      const body = await (await req("/m/m/search?path=/&q=needle&mode=fuzzy")).json();
      expect(names(body)).toEqual(["/pub/needle.txt"]);
      expect(body.items[0].caps).toEqual(READ_ONLY_CAPS);
    });

    it("returns the best `limit` matches and flags truncation", async () => {
      const { req } = setup({
        files: { "/x/a-long-name.txt": "a", "/a1.txt": "a", "/a2.txt": "a" },
      });
      const cut = await (await req("/m/m/search?path=/&q=a&limit=2&mode=fuzzy")).json();
      expect(names(cut)).toEqual(["/a1.txt", "/a2.txt"]);
      expect(cut.truncated).toBe(true);
      const all = await (await req("/m/m/search?path=/&q=a&limit=10&mode=fuzzy")).json();
      expect(all.items).toHaveLength(3);
      expect(all.truncated).toBe(false);
    });

    it("passes the mode to the driver and re-ranks its results", async () => {
      const base = memoryDriver({ files: {} });
      const entry = (path: string) => ({
        path,
        name: path.slice(path.lastIndexOf("/") + 1),
        kind: "file" as const,
        size: 1,
        mtime: 0,
        etag: path,
      });
      let mode: string | undefined;
      const driver: FmDriver = {
        ...base,
        search: async (_dir, _q, opts) => {
          mode = opts.mode;
          return [
            entry("/docs/maintenance.md"),
            entry("/src/main.ts"),
          ];
        },
      };
      const { req } = setup({
        mounts: [
          { id: "m", label: "M", driver },
        ],
      });
      const body = await (await req("/m/m/search?path=/&q=main&mode=fuzzy")).json();
      expect(mode).toBe("fuzzy");
      expect(names(body)).toEqual(["/src/main.ts", "/docs/maintenance.md"]);
      await req("/m/m/search?path=/&q=main");
      expect(mode).toBe("substring");
    });

    it("rejects unknown modes", async () => {
      const { req } = setup();
      expect((await req("/m/m/search?path=/&q=a&mode=regex")).status).toBe(422);
    });
  });
});

describe("driver trash", () => {
  function nativeSetup(extra: FmMount[] = []) {
    const driver = memoryDriver({
      files: { "/a.txt": "a", "/d/b.txt": "b" },
      nativeTrash: true,
    });
    return {
      ...setup({
        mounts: [
          {
            id: "m",
            label: "Main",
            driver,
            trash: true,
          },
          ...extra,
        ],
      }),
      driver,
    };
  }

  it("deletes into the driver's trash, lists, restores beside a clash and purges", async () => {
    const { req, json, driver } = nativeSetup();
    expect(driver.trash).toBeDefined();
    const del = (await (await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/a.txt", "/d"],
    })).json()).results;
    expect(del.every((r: { ok: boolean; trashId?: string }) => r.ok && r.trashId)).toBe(true);
    await expect(driver.stat("/a.txt")).rejects.toThrow();
    // No trash folder on the driver.
    await expect(driver.stat("/.fm-trash")).rejects.toThrow();
    expect((await driver.trash!.list()).map(i => i.path).sort()).toEqual(["/a.txt", "/d"]);

    const { items } = await (await req("/m/m/trash")).json();
    expect(items.find((i: { path: string }) => i.path === "/d")).toMatchObject({ name: "d", kind: "dir", size: 0 });

    await driver.write("/a.txt", new TextEncoder().encode("new"));
    const restored = (await (await json("POST", "/m/m/trash/restore", {
      ids: [del[0].trashId, del[1].trashId],
    })).json()).results;
    expect(restored.map((r: { entry: { path: string } }) => r.entry.path)).toEqual(["/a (1).txt", "/d"]);
    expect((await driver.stat("/d/b.txt")).size).toBe(1);
    expect((await (await req("/m/m/trash")).json()).items).toEqual([]);

    const again = (await (await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/a.txt", "/d"],
    })).json()).results;
    await json("POST", "/m/m/trash/purge", {
      ids: [again[0].trashId],
    });
    expect((await (await req("/m/m/trash")).json()).items).toHaveLength(1);
    await json("POST", "/m/m/trash/purge", {});
    expect(await driver.trash!.list()).toEqual([]);
    const unknown = (await (await json("POST", "/m/m/trash/restore", {
      ids: ["nope"],
    })).json()).results;
    expect(unknown[0].error.code).toBe("NOT_FOUND");
  });

  it("prefers the driver's expiry over the mount retention", async () => {
    const base = memoryDriver({
      files: { "/a.txt": "a" },
      nativeTrash: true,
    });
    const expires = Date.UTC(2030, 0, 1);
    const driver: FmDriver = {
      ...base,
      trash: {
        ...base.trash!,
        list: async () => (await base.trash!.list()).map(i => ({ ...i, expiresAt: expires })),
        get: async id => ({
          ...await base.trash!.get(id),
          expiresAt: expires,
        }),
      },
    };
    const { req, json } = setup({
      mounts: [
        {
          id: "m",
          label: "Main",
          driver,
          trash: { retentionDays: 7 },
        },
      ],
    });
    await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/a.txt"],
    });
    const { items } = await (await req("/m/m/trash")).json();
    expect(items[0].expiresAt).toBe(new Date(expires).toISOString());
  });

  it("trashes the source of a cross-mount move in the driver's trash", async () => {
    const { json, driver } = nativeSetup([
      {
        id: "o",
        label: "Other",
        driver: memoryDriver(),
      },
    ]);
    const res = (await (await json("POST", "/m/m/ops", {
      op: "move",
      paths: ["/a.txt"],
      dest: "/",
      destMount: "o",
    })).json()).results;
    expect(res[0].ok).toBe(true);
    expect((await driver.trash!.list()).map(i => i.path)).toEqual(["/a.txt"]);
  });
});

describe("trash", () => {
  function trashSetup(authorize?: (path: string) => FmCaps) {
    const driver = memoryDriver({
      files: { "/a.txt": "a", "/d/b.txt": "b", "/locked/c.txt": "c" },
    });
    return {
      ...setup({
        mounts: [
          {
            id: "m",
            label: "Main",
            driver,
            trash: true,
          },
        ],
        ...(authorize
          ? { authorize }
          : {}),
      }),
      driver,
    };
  }

  it("moves deleted entries to a hidden trash and restores them", async () => {
    const { req, json, driver } = trashSetup();
    expect((await (await req("/mounts")).json()).mounts[0].trash).toBe(true);
    const del = (await (await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/a.txt", "/d"],
    })).json()).results;
    expect(del.every((r: { ok: boolean; trashId?: string }) => r.ok && r.trashId)).toBe(true);
    await expect(driver.stat("/a.txt")).rejects.toThrow();

    const root = await (await req("/m/m/list?path=/")).json();
    expect(root.items.map((e: { name: string }) => e.name)).toEqual(["locked"]);
    expect((await req(`/m/m/list?path=${q("/.fm-trash")}`)).status).toBe(404);

    const { items } = await (await req("/m/m/trash")).json();
    expect(items.map((i: { path: string }) => i.path).sort()).toEqual(["/a.txt", "/d"]);
    expect(items.find((i: { path: string }) => i.path === "/d")).toMatchObject({ name: "d", kind: "dir", size: 0 });

    await driver.write("/a.txt", new TextEncoder().encode("new"));
    const restored = (await (await json("POST", "/m/m/trash/restore", {
      ids: [del[0].trashId, del[1].trashId],
    })).json()).results;
    expect(restored.map((r: { entry: { path: string } }) => r.entry.path)).toEqual(["/a (1).txt", "/d"]);
    expect((await driver.stat("/d/b.txt")).size).toBe(1);
    expect((await (await req("/m/m/trash")).json()).items).toEqual([]);
  });

  it("purges expired items on listing and through purgeExpired", async () => {
    const driver = memoryDriver({
      files: { "/a.txt": "a", "/b.txt": "b" },
    });
    const mount = {
      id: "m",
      label: "Main",
      driver,
      trash: { retentionDays: 7 },
    };
    const { req, json } = setup({
      mounts: [mount],
    });
    expect((await (await req("/mounts")).json()).mounts[0]).toMatchObject({ trash: true, trashRetentionDays: 7 });
    const del = (await (await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/a.txt", "/b.txt"],
    })).json()).results;
    const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const meta = `/.fm-trash/${del[0].trashId}.json`;
    const body = JSON.parse(new TextDecoder().decode(await readAll((await driver.read(meta)).body)));
    await driver.write(meta, new TextEncoder().encode(JSON.stringify({ ...body, deletedAt: old })));

    const { items } = await (await req("/m/m/trash")).json();
    expect(items.map((i: { path: string }) => i.path)).toEqual(["/b.txt"]);
    expect(Date.parse(items[0].expiresAt) - Date.parse(items[0].deletedAt)).toBe(7 * 86_400_000);
    expect(await driver.list("/.fm-trash")).toHaveLength(2);

    expect(await purgeExpired(mount, Date.now() + 6 * 86_400_000)).toBe(0);
    expect(await purgeExpired(mount, Date.now() + 8 * 86_400_000)).toBe(1);
    expect(await driver.list("/.fm-trash")).toEqual([]);
    expect(await purgeExpired({ ...mount, trash: true })).toBe(0);
  });

  it("purges selected items or everything, and deletes permanently on request", async () => {
    const { req, json, driver } = trashSetup();
    const del = (await (await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/a.txt", "/d"],
    })).json()).results;
    expect((await (await json("POST", "/m/m/trash/purge", {
      ids: [del[0].trashId],
    })).json()).results[0].ok).toBe(true);
    expect((await (await req("/m/m/trash")).json()).items).toHaveLength(1);
    await json("POST", "/m/m/trash/purge", {});
    expect((await (await req("/m/m/trash")).json()).items).toEqual([]);

    const perm = (await (await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/locked/c.txt"],
      permanent: true,
    })).json()).results;
    expect(perm[0].trashId).toBeUndefined();
    expect(await driver.list("/.fm-trash")).toEqual([]);
  });

  it("authorizes trash items against their original path", async () => {
    const { req, json } = trashSetup(p => (p.startsWith("/locked")
      ? READ_ONLY_CAPS
      : (p.startsWith("/.fm-trash")
          ? NONE
          : { ...READ_ONLY_CAPS, write: true, delete: true })));
    const del = (await (await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/a.txt"],
    })).json()).results;
    expect(del[0].ok).toBe(true);
    expect((await (await req("/m/m/trash")).json()).items).toHaveLength(1);
    const unknown = (await (await json("POST", "/m/m/trash/restore", {
      ids: ["nope"],
    })).json()).results;
    expect(unknown[0].error.code).toBe("NOT_FOUND");
  });

  it("is unavailable on mounts without trash", async () => {
    const { req, json } = setup({
      files: { "/a.txt": "a" },
    });
    expect((await req("/m/m/trash")).status).toBe(405);
    const del = (await (await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/a.txt"],
    })).json()).results;
    expect(del[0].trashId).toBeUndefined();
  });
});

describe("change events", () => {
  function eventSetup(opts: { files?: Record<string, string>; trash?: boolean } = {}) {
    const events: FmChangeEvent[] = [];
    const driver = memoryDriver({ files: opts.files ?? {} });
    const s = setup({
      mounts: [
        {
          id: "m",
          label: "Main",
          driver,
          ...(opts.trash
            ? { trash: true }
            : {}),
        },
      ],
      onEvent: (_c, e) => {
        events.push(e);
      },
    });
    return { ...s, driver, events };
  }

  it("reports writes and mkdir", async () => {
    const { req, json, events } = eventSetup({
      files: { "/a.txt": "a" },
    });
    await req(`/m/m/write?path=${q("/a.txt")}&conflict=rename`, { method: "PUT", body: "x" });
    expect((await req(`/m/m/write?path=${q("/a.txt")}&conflict=fail`, { method: "PUT", body: "x" })).status).toBe(409);
    await json("POST", "/m/m/mkdir", { path: "/new" });
    expect(events).toEqual([
      {
        op: "write",
        mount: "m",
        path: "/a (1).txt",
        ok: true,
      },
      {
        op: "write",
        mount: "m",
        path: "/a.txt",
        ok: false,
        error: {
          code: "EXISTS",
          message: expect.any(String),
        },
      },
      {
        op: "mkdir",
        mount: "m",
        path: "/new",
        ok: true,
      },
    ]);
  });

  it("reports each delete item, including failures", async () => {
    const { json, events } = eventSetup({
      files: { "/a.txt": "a" },
    });
    await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/a.txt", "/missing"],
    });
    expect(events).toEqual([
      {
        op: "delete",
        mount: "m",
        path: "/a.txt",
        ok: true,
      },
      {
        op: "delete",
        mount: "m",
        path: "/missing",
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: expect.any(String),
        },
      },
    ]);
  });

  it("reports rename, move and copy with their destinations", async () => {
    const { json, events } = eventSetup({
      files: { "/a.txt": "a", "/b.txt": "b", "/dst/b.txt": "old" },
    });
    await json("POST", "/m/m/ops", { op: "rename", path: "/a.txt", name: "c.txt" });
    await json("POST", "/m/m/ops", {
      op: "copy",
      paths: ["/c.txt", "/b.txt"],
      dest: "/dst",
    });
    await json("POST", "/m/m/ops", {
      op: "move",
      paths: ["/c.txt"],
      dest: "/dst",
      conflict: "rename",
    });
    await json("POST", "/m/m/ops", {
      op: "move",
      paths: ["/dst/b.txt"],
      dest: "/dst",
    });
    expect(events).toEqual([
      {
        op: "rename",
        mount: "m",
        path: "/a.txt",
        to: "/c.txt",
        ok: true,
      },
      {
        op: "copy",
        mount: "m",
        path: "/c.txt",
        to: "/dst/c.txt",
        ok: true,
      },
      {
        op: "copy",
        mount: "m",
        path: "/b.txt",
        ok: false,
        error: {
          code: "EXISTS",
          message: expect.any(String),
        },
      },
      {
        op: "move",
        mount: "m",
        path: "/c.txt",
        to: "/dst/c (1).txt",
        ok: true,
      },
      {
        op: "move",
        mount: "m",
        path: "/dst/b.txt",
        to: "/dst/b.txt",
        ok: true,
      },
    ]);
  });

  it("reports trash delete, restore and purge", async () => {
    const { json, driver, events } = eventSetup({
      files: { "/a.txt": "a", "/b.txt": "b", "/c.txt": "c" },
      trash: true,
    });
    const del = (await (await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/a.txt", "/b.txt", "/c.txt"],
    })).json()).results;
    const [a, b, c] = del.map((r: { trashId: string }) => r.trashId);
    await driver.write("/a.txt", new TextEncoder().encode("new"));
    await json("POST", "/m/m/trash/restore", {
      ids: [a, "nope"],
    });
    await json("POST", "/m/m/trash/purge", {
      ids: [b],
    });
    await json("POST", "/m/m/trash/purge", {});
    expect(events).toEqual([
      {
        op: "delete",
        mount: "m",
        path: "/a.txt",
        trashId: a,
        ok: true,
      },
      {
        op: "delete",
        mount: "m",
        path: "/b.txt",
        trashId: b,
        ok: true,
      },
      {
        op: "delete",
        mount: "m",
        path: "/c.txt",
        trashId: c,
        ok: true,
      },
      {
        op: "restore",
        mount: "m",
        path: "/a.txt",
        to: "/a (1).txt",
        trashId: a,
        ok: true,
      },
      {
        op: "restore",
        mount: "m",
        path: "nope",
        trashId: "nope",
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: expect.any(String),
        },
      },
      {
        op: "purge",
        mount: "m",
        path: "/b.txt",
        trashId: b,
        ok: true,
      },
      {
        op: "purge",
        mount: "m",
        path: "/c.txt",
        trashId: c,
        ok: true,
      },
    ]);
  });

  it("ignores a throwing or rejecting hook", async () => {
    const files = { "/a.txt": "a" };
    const body = {
      op: "delete",
      paths: ["/a.txt", "/missing"],
    };
    const plain = await setup({ files }).json("POST", "/m/m/ops", body);
    const expected = { status: plain.status, body: await plain.json() };
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const onEvent of [
        () => {
          throw new Error("sync");
        },
        async () => {
          throw new Error("async");
        },
      ]) {
        spy.mockClear();
        const res = await setup({ files, onEvent }).json("POST", "/m/m/ops", body);
        expect({ status: res.status, body: await res.json() }).toEqual(expected);
        expect(spy).toHaveBeenCalledTimes(2);
      }
    }
    finally {
      spy.mockRestore();
    }
  });
});

describe("cross-mount ops", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const text = async (d: FmDriver, path: string) => new TextDecoder().decode(await readAll((await d.read(path)).body));
  const has = (d: FmDriver, path: string) => d.stat(path).then(() => true, () => false);
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp)
      await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  async function crossSetup(opts: {
    files?: Record<string, string>;
    trash?: boolean;
    authorize?: (mount: string, path: string) => FmCaps;
    archiveMaxEntries?: number;
    wrap?: (d: FmDriver) => FmDriver;
  } = {}) {
    tmp = await mkdtemp(join(tmpdir(), "fm-cross-"));
    const drivers: Record<string, FmDriver> = {
      mem: memoryDriver(),
      disk: localDriver({ root: tmp }),
    };
    for (const d of Object.values(drivers)) {
      for (const [path, body] of Object.entries(opts.files ?? {}))
        await d.write(path, enc(body));
    }
    const mounts: FmMount[] = Object.entries(drivers).map(([id, driver]) => ({
      id,
      label: id,
      driver: opts.wrap
        ? opts.wrap(driver)
        : driver,
      ...(opts.trash
        ? { trash: true }
        : {}),
    }));
    const events: FmChangeEvent[] = [];
    const app = new Hono();
    app.route("/fm", createFmRouter({
      mounts: () => mounts,
      ...(opts.authorize
        ? {
            authorize: (_c, t) => opts.authorize!(t.mount.id, t.path),
          }
        : {}),
      onEvent: (_c, e) => {
        events.push(e);
      },
      limits: { archiveMaxEntries: opts.archiveMaxEntries ?? 100 },
    }));
    const ops = async (mount: string, body: unknown) => {
      const res = await app.request(`/fm/m/${mount}/ops`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };
    return { app, drivers, events, ops };
  }

  for (const [from, to] of [
    ["mem", "disk"],
    ["disk", "mem"],
  ] as const) {
    describe(`${from} -> ${to}`, () => {
      it("copies a file and a nested folder", async () => {
        const { drivers, ops } = await crossSetup({
          files: { "/a.txt": "a", "/d/x.txt": "x", "/d/sub/y.txt": "y" },
        });
        await drivers[to]!.remove("/a.txt");
        await drivers[to]!.remove("/d");
        await drivers[to]!.mkdir("/in");
        const res = await ops(from, {
          op: "copy",
          paths: ["/a.txt", "/d"],
          dest: "/in",
          destMount: to,
        });
        expect(res.status).toBe(200);
        expect(res.body.results).toEqual([
          expect.objectContaining({
            path: "/a.txt",
            ok: true,
            entry: expect.objectContaining({ mount: to, path: "/in/a.txt", kind: "file" }),
          }),
          expect.objectContaining({
            path: "/d",
            ok: true,
            entry: expect.objectContaining({ mount: to, path: "/in/d", kind: "dir" }),
          }),
        ]);
        expect(await text(drivers[to]!, "/in/a.txt")).toBe("a");
        expect(await text(drivers[to]!, "/in/d/x.txt")).toBe("x");
        expect(await text(drivers[to]!, "/in/d/sub/y.txt")).toBe("y");
        expect(await text(drivers[from]!, "/a.txt")).toBe("a");
        expect(await text(drivers[from]!, "/d/sub/y.txt")).toBe("y");
      });

      it("moves a file and a folder", async () => {
        const { drivers, ops } = await crossSetup({
          files: { "/a.txt": "a", "/d/x.txt": "x" },
        });
        await drivers[to]!.remove("/a.txt");
        await drivers[to]!.remove("/d");
        const res = await ops(from, {
          op: "move",
          paths: ["/a.txt", "/d"],
          dest: "/",
          destMount: to,
        });
        expect(res.body.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true]);
        expect(await text(drivers[to]!, "/a.txt")).toBe("a");
        expect(await text(drivers[to]!, "/d/x.txt")).toBe("x");
        expect(await has(drivers[from]!, "/a.txt")).toBe(false);
        expect(await has(drivers[from]!, "/d")).toBe(false);
      });

      it("moves into the source trash when enabled", async () => {
        const { app, drivers, ops } = await crossSetup({
          files: { "/a.txt": "a" },
          trash: true,
        });
        await drivers[to]!.remove("/a.txt");
        const res = await ops(from, {
          op: "move",
          paths: ["/a.txt"],
          dest: "/",
          destMount: to,
        });
        expect(res.body.results[0].ok).toBe(true);
        expect(await text(drivers[to]!, "/a.txt")).toBe("a");
        expect(await has(drivers[from]!, "/a.txt")).toBe(false);
        const { items } = await (await app.request(`/fm/m/${from}/trash`)).json();
        expect(items.map((i: { path: string }) => i.path)).toEqual(["/a.txt"]);
      });

      it("handles each conflict mode", async () => {
        const { drivers, ops } = await crossSetup({
          files: { "/a.txt": "a" },
        });
        await drivers[to]!.write("/a.txt", enc("old"));
        const fail = await ops(from, {
          op: "copy",
          paths: ["/a.txt"],
          dest: "/",
          destMount: to,
        });
        expect(fail.body.results).toEqual([
          {
            path: "/a.txt",
            ok: false,
            error: expect.objectContaining({ code: "EXISTS" }),
          },
        ]);
        expect(await text(drivers[to]!, "/a.txt")).toBe("old");

        const rename = await ops(from, {
          op: "copy",
          paths: ["/a.txt"],
          dest: "/",
          destMount: to,
          conflict: "rename",
        });
        expect(rename.body.results[0].entry.path).toBe("/a (1).txt");
        expect(await text(drivers[to]!, "/a (1).txt")).toBe("a");
        expect(await text(drivers[to]!, "/a.txt")).toBe("old");

        const overwrite = await ops(from, {
          op: "move",
          paths: ["/a.txt"],
          dest: "/",
          destMount: to,
          conflict: "overwrite",
        });
        expect(overwrite.body.results[0].ok).toBe(true);
        expect(await text(drivers[to]!, "/a.txt")).toBe("a");
        expect(await has(drivers[from]!, "/a.txt")).toBe(false);
      });

      it("authorizes the source and the destination", async () => {
        const { drivers, ops } = await crossSetup({
          files: { "/a.txt": "a", "/secret.txt": "s" },
          authorize: (mount, path) => {
            if (mount === from && path === "/a.txt")
              return { ...ALL_CAPS, copy: false, move: false };
            if (mount === from && path === "/secret.txt")
              return NONE;
            if (mount === to && path === "/ro")
              return READ_ONLY_CAPS;
            return ALL_CAPS;
          },
        });
        await drivers[to]!.remove("/a.txt");
        await drivers[to]!.remove("/secret.txt");
        await drivers[to]!.mkdir("/ro");
        const src = await ops(from, {
          op: "move",
          paths: ["/a.txt", "/secret.txt"],
          dest: "/",
          destMount: to,
        });
        expect(src.body.results).toEqual([
          {
            path: "/a.txt",
            ok: false,
            error: expect.objectContaining({ code: "FORBIDDEN" }),
          },
          {
            path: "/secret.txt",
            ok: false,
            error: expect.objectContaining({ code: "NOT_FOUND" }),
          },
        ]);
        const dest = await ops(from, {
          op: "copy",
          paths: ["/a.txt"],
          dest: "/ro",
          destMount: to,
        });
        expect(dest.status).toBe(403);
        expect(await drivers[to]!.list("/")).toEqual([
          expect.objectContaining({ path: "/ro" }),
        ]);
        expect(await drivers[to]!.list("/ro")).toEqual([]);
        expect(await text(drivers[from]!, "/a.txt")).toBe("a");
      });

      it("keeps the source and leaves no partial copy when a write fails", async () => {
        let writes = 0;
        const { drivers, ops } = await crossSetup({
          files: { "/d/x.txt": "x", "/d/y.txt": "y", "/ok.txt": "ok" },
          wrap: d => ({
            ...d,
            write: async (path, body, o) => {
              if (path.startsWith("/in/d/") && ++writes === 2)
                throw new FmError("UNSUPPORTED", "disk full");
              return d.write(path, body, o);
            },
          }),
        });
        await drivers[to]!.remove("/d");
        await drivers[to]!.remove("/ok.txt");
        const res = await ops(from, {
          op: "move",
          paths: ["/d", "/ok.txt"],
          dest: "/in",
          destMount: to,
        });
        expect(res.body.results).toEqual([
          {
            path: "/d",
            ok: false,
            error: { code: "UNSUPPORTED", message: "disk full" },
          },
          expect.objectContaining({ path: "/ok.txt", ok: true }),
        ]);
        expect(await has(drivers[to]!, "/in/d")).toBe(false);
        expect(await text(drivers[to]!, "/in/ok.txt")).toBe("ok");
        expect(await text(drivers[from]!, "/d/x.txt")).toBe("x");
        expect(await text(drivers[from]!, "/d/y.txt")).toBe("y");
        expect(await has(drivers[from]!, "/ok.txt")).toBe(false);
      });

      it("fails with TOO_LARGE past archiveMaxEntries and writes nothing", async () => {
        const { drivers, ops } = await crossSetup({
          files: { "/d/1.txt": "1", "/d/2.txt": "2", "/d/3.txt": "3" },
          archiveMaxEntries: 3,
        });
        await drivers[to]!.remove("/d");
        const res = await ops(from, {
          op: "move",
          paths: ["/d"],
          dest: "/",
          destMount: to,
        });
        expect(res.body.results).toEqual([
          {
            path: "/d",
            ok: false,
            error: expect.objectContaining({ code: "TOO_LARGE" }),
          },
        ]);
        expect(await has(drivers[to]!, "/d")).toBe(false);
        expect(await text(drivers[from]!, "/d/3.txt")).toBe("3");
      });

      it("emits one event per item", async () => {
        const { drivers, events, ops } = await crossSetup({
          files: { "/a.txt": "a", "/b.txt": "b" },
        });
        await drivers[to]!.remove("/a.txt");
        await ops(from, {
          op: "copy",
          paths: ["/a.txt", "/b.txt"],
          dest: "/",
          destMount: to,
        });
        expect(events).toEqual([
          {
            op: "copy",
            mount: from,
            path: "/a.txt",
            to: "/a.txt",
            toMount: to,
            ok: true,
          },
          {
            op: "copy",
            mount: from,
            path: "/b.txt",
            toMount: to,
            ok: false,
            error: expect.objectContaining({ code: "EXISTS" }),
          },
        ]);
      });
    });
  }

  it("treats destMount equal to the route mount as a same-mount op", async () => {
    const { drivers, events, ops } = await crossSetup({
      files: { "/a.txt": "a" },
    });
    await drivers.mem!.mkdir("/in");
    const res = await ops("mem", {
      op: "move",
      paths: ["/a.txt"],
      dest: "/in",
      destMount: "mem",
    });
    expect(res.body.results).toEqual([
      expect.objectContaining({
        path: "/a.txt",
        ok: true,
        entry: expect.objectContaining({ mount: "mem", path: "/in/a.txt" }),
      }),
    ]);
    expect(await has(drivers.mem!, "/a.txt")).toBe(false);
    expect(events).toEqual([
      {
        op: "move",
        mount: "mem",
        path: "/a.txt",
        to: "/in/a.txt",
        ok: true,
      },
    ]);
  });

  it("answers 404 for an unknown destination mount", async () => {
    const { ops } = await crossSetup({
      files: { "/a.txt": "a" },
    });
    expect((await ops("mem", {
      op: "copy",
      paths: ["/a.txt"],
      dest: "/",
      destMount: "nope",
    })).status).toBe(404);
  });

  describe("hidden targets", () => {
    const reserved = (path: string) => ({
      path,
      ok: false,
      error: { code: "INVALID", message: "Reserved name: /.fm-trash" },
    });

    for (const op of ["move", "copy"] as const) {
      it(`rejects a same-mount ${op} onto the trash folder`, async () => {
        const { drivers, events, ops } = await crossSetup({
          files: { "/x/.fm-trash/f.txt": "f" },
          trash: true,
        });
        const res = await ops("mem", {
          op,
          paths: ["/x/.fm-trash"],
          dest: "/",
        });
        expect(res.body.results).toEqual([
          reserved("/x/.fm-trash"),
        ]);
        expect(await text(drivers.mem!, "/x/.fm-trash/f.txt")).toBe("f");
        expect(await has(drivers.mem!, "/.fm-trash")).toBe(false);
        expect(events).toEqual([
          expect.objectContaining({
            op,
            mount: "mem",
            path: "/x/.fm-trash",
            ok: false,
          }),
        ]);
      });

      it(`rejects a cross-mount ${op} onto the trash folder`, async () => {
        const { drivers, events, ops } = await crossSetup({
          files: { "/x/.fm-trash/f.txt": "f" },
          trash: true,
        });
        const res = await ops("mem", {
          op,
          paths: ["/x/.fm-trash"],
          dest: "/",
          destMount: "disk",
        });
        expect(res.body.results).toEqual([
          reserved("/x/.fm-trash"),
        ]);
        expect(await text(drivers.mem!, "/x/.fm-trash/f.txt")).toBe("f");
        expect(await has(drivers.disk!, "/.fm-trash")).toBe(false);
        expect(events).toEqual([
          expect.objectContaining({
            op,
            mount: "mem",
            path: "/x/.fm-trash",
            ok: false,
          }),
        ]);
      });
    }

    it("rejects a move onto the uploads folder", async () => {
      const { drivers, ops } = await crossSetup({
        files: { "/x/.fm-uploads/f.txt": "f" },
      });
      const res = await ops("mem", {
        op: "move",
        paths: ["/x/.fm-uploads"],
        dest: "/",
      });
      expect(res.body.results).toEqual([
        {
          path: "/x/.fm-uploads",
          ok: false,
          error: { code: "INVALID", message: "Reserved name: /.fm-uploads" },
        },
      ]);
      expect(await text(drivers.mem!, "/x/.fm-uploads/f.txt")).toBe("f");
      expect(await has(drivers.mem!, "/.fm-uploads/f.txt")).toBe(false);
    });

    it("rejects a rename to the trash folder name", async () => {
      const { drivers, events, ops } = await crossSetup({
        files: { "/a/f.txt": "f" },
        trash: true,
      });
      const res = await ops("mem", { op: "rename", path: "/a", name: ".fm-trash" });
      expect(res.body.results).toEqual([
        reserved("/a"),
      ]);
      expect(await text(drivers.mem!, "/a/f.txt")).toBe("f");
      expect(await has(drivers.mem!, "/.fm-trash")).toBe(false);
      expect(events).toEqual([
        expect.objectContaining({
          op: "rename",
          mount: "mem",
          path: "/a",
          ok: false,
        }),
      ]);
    });
  });
});

describe.each([
  [
    "driver multipart",
    () => memoryDriver(),
  ],
  [
    "fallback",
    (): FmDriver => {
      const driver: FmDriver = memoryDriver();
      delete driver.multipart;
      return driver;
    },
  ],
])("upload sessions (%s)", (_name, makeDriver) => {
  function uploadSetup(opts: { files?: Record<string, string>; ttl?: number; authorize?: (path: string) => FmCaps } = {}) {
    const events: FmChangeEvent[] = [];
    const driver = makeDriver();
    const s = setup({
      mounts: [
        { id: "m", label: "Main", driver },
      ],
      onEvent: (_c, e) => {
        events.push(e);
      },
      limits: {
        uploadPartSize: 4,
        maxSessionUploadBytes: 100,
        ...(opts.ttl === undefined
          ? {}
          : { uploadSessionTtlMs: opts.ttl }),
      },
      ...(opts.authorize
        ? { authorize: opts.authorize }
        : {}),
    });
    return {
      ...s,
      driver,
      events,
      ready: (async () => {
        for (const [path, content] of Object.entries(opts.files ?? {}))
          await driver.write(path, new TextEncoder().encode(content));
      })(),
    };
  }

  const put = (req: ReturnType<typeof setup>["req"], id: string, n: number, body: string, length = body.length) =>
    req(`/m/m/uploads/${id}/parts/${n}`, {
      method: "PUT",
      headers: {
        "content-length": String(length),
      },
      body,
    });

  const text = async (driver: FmDriver, path: string) =>
    new TextDecoder().decode(await new Response((await driver.read(path)).body).arrayBuffer());

  it("uploads parts, reports progress and completes", async () => {
    const { req, json, driver, events } = uploadSetup();
    const res = await json("POST", "/m/m/uploads", { path: "/dir/a.txt", size: 10 });
    expect(res.status).toBe(201);
    const session = await res.json();
    expect(session).toMatchObject({
      mode: "chunked",
      path: "/dir/a.txt",
      size: 10,
      partSize: 4,
      parts: 3,
      received: [],
    });
    expect(session.urls).toBeUndefined();
    expect(await (await put(req, session.id, 1, "0123")).json()).toEqual({ n: 1, size: 4 });
    expect((await put(req, session.id, 3, "89")).status).toBe(200);
    expect((await (await req(`/m/m/uploads/${session.id}`)).json()).received).toEqual([1, 3]);
    expect((await put(req, session.id, 2, "4567")).status).toBe(200);

    const root = await (await req("/m/m/list?path=/")).json();
    expect(root.items.map((e: { name: string }) => e.name)).toEqual([]);
    const found = await (await req("/m/m/search?path=/&q=json")).json();
    expect(found.items).toEqual([]);
    expect(events).toEqual([]);

    const done = await json("POST", `/m/m/uploads/${session.id}/complete`, {});
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ path: "/dir/a.txt", size: 10 });
    expect(await text(driver, "/dir/a.txt")).toBe("0123456789");
    expect(events).toEqual([
      {
        op: "write",
        mount: "m",
        path: "/dir/a.txt",
        ok: true,
      },
    ]);
    expect((await req(`/m/m/uploads/${session.id}`)).status).toBe(404);
    expect((await driver.list("/.fm-uploads")).filter(e => e.name.startsWith(session.id))).toEqual([]);
  });

  it("uploads an empty file as one empty part", async () => {
    const { req, json, driver } = uploadSetup();
    const session = await (await json("POST", "/m/m/uploads", { path: "/empty", size: 0 })).json();
    expect(session.parts).toBe(1);
    expect((await put(req, session.id, 1, "")).status).toBe(200);
    expect((await json("POST", `/m/m/uploads/${session.id}/complete`, {})).status).toBe(200);
    expect((await driver.stat("/empty")).size).toBe(0);
  });

  it("resumes after an interrupted part", async () => {
    const { req, json, driver } = uploadSetup();
    const session = await (await json("POST", "/m/m/uploads", { path: "/a.txt", size: 10 })).json();
    expect((await put(req, session.id, 1, "0123")).status).toBe(200);
    expect((await put(req, session.id, 2, "45")).status).toBe(400);
    expect((await put(req, session.id, 2, "45", 4)).status).toBe(400);
    expect((await (await req(`/m/m/uploads/${session.id}`)).json()).received).toEqual([1]);
    expect((await put(req, session.id, 2, "4567")).status).toBe(200);
    expect((await put(req, session.id, 3, "89")).status).toBe(200);
    expect((await json("POST", `/m/m/uploads/${session.id}/complete`, {})).status).toBe(200);
    expect(await text(driver, "/a.txt")).toBe("0123456789");
  });

  it("rejects completing with a missing part", async () => {
    const { req, json, driver, events } = uploadSetup();
    const session = await (await json("POST", "/m/m/uploads", { path: "/a.txt", size: 10 })).json();
    await put(req, session.id, 1, "0123");
    await put(req, session.id, 3, "89");
    const res = await json("POST", `/m/m/uploads/${session.id}/complete`, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: "INVALID", message: "Missing part 2" });
    await expect(driver.stat("/a.txt")).rejects.toThrow();
    expect(events).toEqual([
      expect.objectContaining({ op: "write", path: "/a.txt", ok: false }),
    ]);
    expect((await req(`/m/m/uploads/${session.id}`)).status).toBe(200);
  });

  it("handles conflicts at create and complete", async () => {
    const { req, json, driver, events, ready } = uploadSetup({
      files: { "/a.txt": "old" },
    });
    await ready;
    expect((await json("POST", "/m/m/uploads", { path: "/a.txt", size: 2, conflict: "fail" })).status).toBe(409);

    const renamed = await (await json("POST", "/m/m/uploads", { path: "/a.txt", size: 2 })).json();
    expect(renamed.path).toBe("/a (1).txt");
    await put(req, renamed.id, 1, "hi");
    expect((await json("POST", `/m/m/uploads/${renamed.id}/complete`, {})).status).toBe(200);
    expect(await text(driver, "/a (1).txt")).toBe("hi");
    expect(await text(driver, "/a.txt")).toBe("old");

    for (const conflict of ["fail", "rename"]) {
      events.length = 0;
      const session = await (await json("POST", "/m/m/uploads", { path: `/${conflict}.txt`, size: 2, conflict })).json();
      await put(req, session.id, 1, "hi");
      await driver.write(`/${conflict}.txt`, new TextEncoder().encode("raced"));
      const res = await json("POST", `/m/m/uploads/${session.id}/complete`, {});
      expect(res.status).toBe(409);
      expect(await text(driver, `/${conflict}.txt`)).toBe("raced");
      expect(events).toEqual([
        {
          op: "write",
          mount: "m",
          path: `/${conflict}.txt`,
          ok: false,
          error: expect.objectContaining({ code: "EXISTS" }),
        },
      ]);
    }

    const over = await (await json("POST", "/m/m/uploads", { path: "/a.txt", size: 2, conflict: "overwrite" })).json();
    expect(over.path).toBe("/a.txt");
    await put(req, over.id, 1, "hi");
    expect((await json("POST", `/m/m/uploads/${over.id}/complete`, {})).status).toBe(200);
    expect(await text(driver, "/a.txt")).toBe("hi");
  });

  it("enforces size limits and part numbers", async () => {
    const { req, json } = uploadSetup();
    const big = await json("POST", "/m/m/uploads", { path: "/a.txt", size: 101 });
    expect(big.status).toBe(413);
    expect((await big.json()).error.code).toBe("TOO_LARGE");
    expect((await json("POST", "/m/m/uploads", { path: "//", size: 1 })).status).toBe(400);
    const session = await (await json("POST", "/m/m/uploads", { path: "/a.txt", size: 6 })).json();
    expect((await put(req, session.id, 1, "012")).status).toBe(400);
    expect((await put(req, session.id, 1, "01234")).status).toBe(400);
    expect((await put(req, session.id, 3, "01")).status).toBe(400);
    expect((await put(req, session.id, 0, "")).status).toBe(400);
    expect((await req(`/m/m/uploads/${session.id}/parts/2`, { method: "PUT", body: "45" })).status).toBe(400);
  });

  it("aborts sessions and cleans up expired ones", async () => {
    const { req, json, driver } = uploadSetup();
    const session = await (await json("POST", "/m/m/uploads", { path: "/a.txt", size: 2 })).json();
    await put(req, session.id, 1, "hi");
    const del = await req(`/m/m/uploads/${session.id}`, { method: "DELETE" });
    expect(await del.json()).toEqual({ ok: true });
    expect((await req(`/m/m/uploads/${session.id}`)).status).toBe(404);
    expect((await req(`/m/m/uploads/${session.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await req("/m/m/uploads/nope")).status).toBe(404);
    expect(await driver.list("/.fm-uploads")).toEqual([]);

    const old = await (await json("POST", "/m/m/uploads", { path: "/b.txt", size: 2 })).json();
    await put(req, old.id, 1, "hi");
    const now = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(now + 25 * 60 * 60 * 1000);
    try {
      expect((await req(`/m/m/uploads/${old.id}`)).status).toBe(404);
      const fresh = await (await json("POST", "/m/m/uploads", { path: "/c.txt", size: 2 })).json();
      expect((await driver.list("/.fm-uploads")).map(e => e.name)).toEqual([`${fresh.id}.json`]);
    }
    finally {
      clock.mockRestore();
    }
  });

  it("is bound to its mount", async () => {
    const driver = makeDriver();
    const { req, json } = setup({
      mounts: [
        { id: "a", label: "A", driver },
        { id: "b", label: "B", driver },
      ],
    });
    const session = await (await json("POST", "/m/a/uploads", { path: "/x", size: 1 })).json();
    expect((await req(`/m/b/uploads/${session.id}`)).status).toBe(404);
    expect((await req(`/m/a/uploads/${session.id}`)).status).toBe(200);
  });

  it("re-authorizes every session request", async () => {
    let allow = true;
    const { req, json, driver } = uploadSetup({
      authorize: () => (allow
        ? ALL_CAPS
        : READ_ONLY_CAPS),
    });
    const session = await (await json("POST", "/m/m/uploads", { path: "/a.txt", size: 6 })).json();
    expect((await put(req, session.id, 1, "0123")).status).toBe(200);
    allow = false;
    expect((await put(req, session.id, 2, "45")).status).toBe(403);
    expect((await json("POST", `/m/m/uploads/${session.id}/complete`, {})).status).toBe(403);
    expect((await req(`/m/m/uploads/${session.id}`)).status).toBe(403);
    expect((await req(`/m/m/uploads/${session.id}`, { method: "DELETE" })).status).toBe(403);
    allow = true;
    expect((await (await req(`/m/m/uploads/${session.id}`)).json()).received).toEqual([1]);
    await expect(driver.stat("/a.txt")).rejects.toThrow();
  });

  it("keeps the uploads folder unreachable through regular routes", async () => {
    const { req, json, driver } = uploadSetup();
    const session = await (await json("POST", "/m/m/uploads", { path: "/a.txt", size: 2 })).json();
    await put(req, session.id, 1, "hi");
    await driver.write("/d/f.txt", new TextEncoder().encode("f"));
    const record = q(`/.fm-uploads/${session.id}.json`);
    expect((await req(`/m/m/read?path=${record}`)).status).toBe(404);
    expect((await req(`/m/m/stat?path=${record}`)).status).toBe(404);
    expect((await req(`/m/m/list?path=${q("/.fm-uploads")}`)).status).toBe(404);
    expect((await req(`/m/m/write?path=${q("/.fm-uploads/x")}`, { method: "PUT", body: "x" })).status).toBe(404);
    expect((await json("POST", "/m/m/mkdir", { path: "/.fm-uploads" })).status).toBe(404);
    for (const op of ["move", "copy"]) {
      const from = (await (await json("POST", "/m/m/ops", {
        op,
        paths: [`/.fm-uploads/${session.id}.json`],
        dest: "/d",
      })).json()).results;
      expect(from[0]).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      expect((await json("POST", "/m/m/ops", {
        op,
        paths: ["/d/f.txt"],
        dest: "/.fm-uploads",
      })).status).toBe(404);
    }
    const del = (await (await json("POST", "/m/m/ops", {
      op: "delete",
      paths: ["/.fm-uploads"],
    })).json()).results;
    expect(del[0]).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect((await req(`/m/m/archive?path=${q("/.fm-uploads")}`)).status).toBe(404);
    const usage = await (await req("/m/m/usage?path=/")).json();
    expect(usage).toMatchObject({ files: 1, dirs: 1 });
    const found = await (await req(`/m/m/search?path=/&q=${session.id.slice(0, 8)}`)).json();
    expect(found.items).toEqual([]);
    expect((await (await req(`/m/m/uploads/${session.id}`)).json()).received).toEqual([1]);
  });
});

describe("upload sessions with presigned parts", () => {
  it("returns part URLs and rejects parts sent to the router", async () => {
    const base = memoryDriver();
    const driver: FmDriver = {
      ...base,
      multipart: {
        ...base.multipart!,
        presignPart: async (_p, id, n) => `https://example.test/${id}/${n}`,
      },
    };
    const { req, json } = setup({
      mounts: [
        { id: "m", label: "Main", driver },
      ],
      limits: { uploadPartSize: 4 },
    });
    const session = await (await json("POST", "/m/m/uploads", { path: "/a.txt", size: 10 })).json();
    expect(session.mode).toBe("s3-multipart");
    expect(session.urls).toHaveLength(session.parts);
    expect(session.urls[2]).toMatch(/\/3$/);
    expect((await (await req(`/m/m/uploads/${session.id}`)).json()).urls).toHaveLength(3);
    const res = await req(`/m/m/uploads/${session.id}/parts/1`, {
      method: "PUT",
      headers: { "content-length": "4" },
      body: "0123",
    });
    expect(res.status).toBe(400);
  });
});

describe("thumbnails", () => {
  const files = {
    "/a.png": "png-bytes",
    "/b.svg": "<svg/>",
    "/c.txt": "text",
    "/big.jpg": "x".repeat(64),
    "/locked/d.png": "png",
  };
  const hook = async (_c: unknown, input: { entry: { name: string }; width: number; read: () => Promise<ReadableStream<Uint8Array>> }) => ({
    body: `${input.entry.name}@${input.width}:${new TextDecoder().decode(await readAll(await input.read()))}`,
    type: "image/webp",
  });

  it("serves resized images through the hook with caching", async () => {
    const { req } = setup({ files, thumbnail: hook });
    expect((await (await req("/mounts")).json()).mounts[0].thumbnails).toBe(true);
    const res = await req(`/m/m/thumb?path=${q("/a.png")}&w=256`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("max-age");
    expect(await res.text()).toBe("a.png@256:png-bytes");
    const etag = res.headers.get("etag")!;
    expect(etag).toContain("256");
    expect((await req(`/m/m/thumb?path=${q("/a.png")}&w=256`, {
      headers: { "if-none-match": etag },
    })).status).toBe(304);
  });

  it("answers 404 for other widths, non-images, SVG, large sources, a declining hook or no hook", async () => {
    const { req } = setup({
      files,
      thumbnail: hook,
      limits: { thumbnailMaxBytes: 32 },
    });
    expect((await req(`/m/m/thumb?path=${q("/a.png")}&w=300`)).status).toBe(422);
    for (const p of ["/b.svg", "/c.txt", "/big.jpg"])
      expect((await req(`/m/m/thumb?path=${q(p)}&w=128`)).status).toBe(404);
    const declining = setup({
      files,
      thumbnail: async () => undefined,
    });
    expect((await declining.req(`/m/m/thumb?path=${q("/a.png")}&w=128`)).status).toBe(404);
    const none = setup({ files });
    expect((await none.req("/mounts")).status).toBe(200);
    expect((await (await none.req("/mounts")).json()).mounts[0].thumbnails).toBe(false);
    expect((await none.req(`/m/m/thumb?path=${q("/a.png")}&w=128`)).status).toBe(404);
  });

  it("authorizes like read", async () => {
    const { req } = setup({
      files,
      thumbnail: hook,
      authorize: p => (p.startsWith("/locked")
        ? NONE
        : READ_ONLY_CAPS),
    });
    expect((await req(`/m/m/thumb?path=${q("/locked/d.png")}&w=128`)).status).toBe(404);
    expect((await req(`/m/m/thumb?path=${q("/a.png")}&w=128`)).status).toBe(200);
  });
});

describe("zip browsing", () => {
  const zip = zipSync({
    "a.txt": new TextEncoder().encode("alpha"),
    "dir/b.html": new TextEncoder().encode("<script>x</script>"),
  });
  async function zipSetup(authorize?: (path: string) => FmCaps, limits?: FmRouterOptions<Env>["limits"]) {
    const ctx = setup({
      files: {},
      ...(authorize
        ? { authorize }
        : {}),
      ...(limits
        ? { limits }
        : {}),
    });
    await ctx.driver.write("/z.zip", zip);
    await ctx.driver.write("/locked/z.zip", zip);
    return ctx;
  }

  it("lists entries and streams one, with read's content-type safety", async () => {
    const { req } = await zipSetup();
    const list = await (await req(`/m/m/zip/entries?path=${q("/z.zip")}`)).json();
    expect(list.entries.map((e: { path: string }) => e.path)).toEqual(["a.txt", "dir/b.html"]);
    expect(list.truncated).toBe(false);
    const a = await req(`/m/m/zip/read?path=${q("/z.zip")}&entry=${q("a.txt")}`);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toContain("text/plain");
    expect(await a.text()).toBe("alpha");
    const html = await req(`/m/m/zip/read?path=${q("/z.zip")}&entry=${q("dir/b.html")}`);
    expect(html.headers.get("content-type")).toContain("text/plain");
    expect(html.headers.get("content-security-policy")).toContain("sandbox");
    const dl = await req(`/m/m/zip/read?path=${q("/z.zip")}&entry=${q("a.txt")}&download=1`);
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    expect(dl.headers.get("content-disposition")).toContain("a.txt");
  });

  it("answers 404 for missing entries, 400 for non-zips, and authorizes like read", async () => {
    const { req, driver } = await zipSetup(p => (p.startsWith("/locked")
      ? NONE
      : READ_ONLY_CAPS));
    expect((await req(`/m/m/zip/read?path=${q("/z.zip")}&entry=${q("nope")}`)).status).toBe(404);
    await driver.write("/fake.zip", new TextEncoder().encode("nope"));
    expect((await req(`/m/m/zip/entries?path=${q("/fake.zip")}`)).status).toBe(400);
    expect((await req(`/m/m/zip/entries?path=${q("/locked/z.zip")}`)).status).toBe(404);
  });

  it("applies the archive limits", async () => {
    const { req } = await zipSetup(undefined, { archiveMaxEntries: 1 });
    const list = await (await req(`/m/m/zip/entries?path=${q("/z.zip")}`)).json();
    expect(list).toMatchObject({ truncated: true });
    const small = await zipSetup(undefined, { archiveMaxBytes: 10 });
    expect((await small.req(`/m/m/zip/entries?path=${q("/z.zip")}`)).status).toBe(413);
  });
});

describe("change messages", () => {
  function recording() {
    const base = memoryDriver({
      files: { "/a.txt": "a", "/b.txt": "b" },
    });
    const calls: string[] = [];
    const note = (op: string) => (ctx?: { message?: string }) => calls.push(`${op}:${ctx?.message ?? "-"}`);
    const driver: FmDriver = {
      ...base,
      write: (p, body, o) => {
        note("write")(o);
        return base.write(p, body, o);
      },
      mkdir: (p, ctx) => {
        note("mkdir")(ctx);
        return base.mkdir(p);
      },
      move: (a, b, ctx) => {
        note("move")(ctx);
        return base.move(a, b);
      },
      copy: (a, b, ctx) => {
        note("copy")(ctx);
        return base.copy(a, b);
      },
      remove: (p, ctx) => {
        note("remove")(ctx);
        return base.remove(p);
      },
    };
    const events: FmChangeEvent[] = [];
    const ctx = setup({
      mounts: [
        { id: "m", label: "M", driver },
      ],
      onEvent: (_c, e) => void events.push(e),
    });
    return { ...ctx, calls, events };
  }
  const msg = (m: string) => ({
    "x-fm-message": encodeURIComponent(m),
  });

  it("passes X-Fm-Message to every changing driver call and to onEvent", async () => {
    const { req, calls, events } = recording();
    const h = msg("Fix typo · 修正");
    await req(`/m/m/write?path=${q("/a.txt")}`, { method: "PUT", body: "x", headers: h });
    await req("/m/m/mkdir", {
      method: "POST",
      body: JSON.stringify({ path: "/d" }),
      headers: { ...h, "content-type": "application/json" },
    });
    const ops = (body: unknown) => req("/m/m/ops", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { ...h, "content-type": "application/json" },
    });
    await ops({ op: "rename", path: "/a.txt", name: "c.txt" });
    await ops({
      op: "copy",
      paths: ["/b.txt"],
      dest: "/d",
    });
    await ops({
      op: "move",
      paths: ["/b.txt"],
      dest: "/d",
      conflict: "rename",
    });
    await ops({
      op: "delete",
      paths: ["/c.txt"],
      permanent: true,
    });
    expect(calls).toEqual([
      "write:Fix typo · 修正",
      "mkdir:Fix typo · 修正",
      "move:Fix typo · 修正",
      "copy:Fix typo · 修正",
      "move:Fix typo · 修正",
      "remove:Fix typo · 修正",
    ]);
    expect(events.map(e => e.message)).toEqual(Array.from<string>({ length: 6 }).fill("Fix typo · 修正"));
  });

  it("leaves the message out without the header and rejects long ones", async () => {
    const { req, calls, events } = recording();
    await req(`/m/m/write?path=${q("/a.txt")}`, { method: "PUT", body: "x" });
    expect(calls).toEqual(["write:-"]);
    expect(events[0]!.message).toBeUndefined();
    const res = await req(`/m/m/write?path=${q("/a.txt")}`, {
      method: "PUT",
      body: "x",
      headers: msg("x".repeat(1001)),
    });
    expect(res.status).toBe(400);
  });
});

describe("changes", () => {
  function changesSetup(authorize?: (path: string) => FmCaps) {
    const base = memoryDriver({
      files: { "/a.txt": "new a", "/secret/s.txt": "s", "/b.txt": "b" },
    });
    const driver: FmDriver = {
      ...base,
      changes: {
        list: async () => [
          {
            path: "/a.txt",
            status: "modified",
            additions: 1,
            deletions: 1,
          },
          { path: "/secret/s.txt", status: "added" },
          { path: "/b.txt", status: "renamed", previousPath: "/old-b.txt" },
          { path: "/.fm-trash/x/y", status: "added" },
        ],
        readBase: async p => (p === "/a.txt"
          ? {
              body: new Blob(["old a"]).stream(),
              size: 5,
            }
          : null),
      },
    };
    return setup({
      mounts: [
        {
          id: "m",
          label: "M",
          driver,
          trash: true,
        },
        { id: "plain", label: "P", driver: base },
      ],
      ...(authorize
        ? { authorize }
        : {}),
    });
  }

  it("lists changes the caller may read and serves base versions", async () => {
    const { req } = changesSetup(p => (p.startsWith("/secret")
      ? NONE
      : READ_ONLY_CAPS));
    const mounts = (await (await req("/mounts")).json()).mounts;
    expect(mounts.map((m: { changes: boolean }) => m.changes)).toEqual([true, false]);
    const { changes } = await (await req("/m/m/changes")).json();
    expect(changes.map((c: { path: string }) => c.path)).toEqual(["/a.txt", "/b.txt"]);
    expect(changes[1]).toMatchObject({ status: "renamed", previousPath: "/old-b.txt" });
    const base = await req(`/m/m/changes/base?path=${q("/a.txt")}`);
    expect(base.status).toBe(200);
    expect(base.headers.get("content-security-policy")).toContain("sandbox");
    expect(await base.text()).toBe("old a");
    expect((await req(`/m/m/changes/base?path=${q("/b.txt")}`)).status).toBe(404);
    expect((await req(`/m/m/changes/base?path=${q("/secret/s.txt")}`)).status).toBe(404);
    expect((await req("/m/plain/changes")).status).toBe(405);
  });
});

describe("changes with renames across permissions", () => {
  it("hides previous paths and baselines the caller may not read", async () => {
    const base = memoryDriver({
      files: { "/pub/a.txt": "now", "/pub/b.txt": "b" },
    });
    const driver: FmDriver = {
      ...base,
      changes: {
        list: async () => [
          { path: "/pub/a.txt", status: "renamed", previousPath: "/secret/a.txt" },
          { path: "/pub/b.txt", status: "renamed", previousPath: "/pub/old-b.txt" },
        ],
        readBase: async p => (p === "/pub/a.txt"
          ? {
              body: new Blob(["secret before"]).stream(),
              size: 13,
              from: "/secret/a.txt",
            }
          : {
              body: new Blob(["old b"]).stream(),
              size: 5,
              from: "/pub/old-b.txt",
            }),
      },
    };
    const { req } = setup({
      mounts: [
        { id: "m", label: "M", driver },
      ],
      authorize: p => (p.startsWith("/secret")
        ? NONE
        : READ_ONLY_CAPS),
    });
    const { changes } = await (await req("/m/m/changes")).json();
    expect(changes).toEqual([
      { path: "/pub/a.txt", status: "added" },
      { path: "/pub/b.txt", status: "renamed", previousPath: "/pub/old-b.txt" },
    ]);
    expect((await req(`/m/m/changes/base?path=${q("/pub/a.txt")}`)).status).toBe(404);
    expect(await (await req(`/m/m/changes/base?path=${q("/pub/b.txt")}`)).text()).toBe("old b");
  });
});

describe("mount options for flat storages", () => {
  it("reports implicit folders and refuses upload sessions when uploads are off", async () => {
    const driver = memoryDriver({ files: {} });
    const { req, json } = setup({
      mounts: [
        {
          id: "m",
          label: "M",
          driver,
          implicitFolders: true,
          uploads: false,
        },
        { id: "n", label: "N", driver },
      ],
    });
    const info = (await (await req("/mounts")).json()).mounts;
    expect(info.map((m: { implicitFolders: boolean; uploadSessions: boolean }) => [m.implicitFolders, m.uploadSessions])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect((await json("POST", "/m/m/uploads", { path: "/big.bin", size: 100 })).status).toBe(405);
    expect((await json("POST", "/m/n/uploads", { path: "/big.bin", size: 100 })).status).toBe(201);
  });
});
