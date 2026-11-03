import type { FmCaps } from "../core/schema";
import type { FmDriver } from "./driver";
import type { FmMount } from "./router";
import { describe, expect, it } from "bun:test";
import { unzipSync } from "fflate";
import { Hono } from "hono";
import { READ_ONLY_CAPS } from "../core/schema";
import { memoryDriver } from "../drivers/memory";
import { createFmRouter } from "./router";

const NONE: FmCaps = {
  read: false,
  write: false,
  delete: false,
  rename: false,
  move: false,
  copy: false,
};

function setup(opts: { files?: Record<string, string>; mounts?: FmMount[]; authorize?: (path: string) => FmCaps; maxUploadBytes?: number } = {}) {
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
    limits: { maxUploadBytes: opts.maxUploadBytes ?? 1024, archiveMaxEntries: 10 },
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

  it("refuses files and empty queries", async () => {
    const { req } = setup({
      files: { "/a.txt": "a" },
    });
    const res = await req(`/m/m/search?path=${q("/a.txt")}&q=a`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("NOT_A_DIR");
    expect((await req("/m/m/search?path=/&q=%20")).status).toBe(422);
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
