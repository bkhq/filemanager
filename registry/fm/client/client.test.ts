import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { memoryDriver } from "../drivers/memory";
import { createFmRouter } from "../server/router";
import { createFmClient, FmApiError } from "./client";

function client() {
  const app = new Hono();
  const mounts = [
    {
      id: "m",
      label: "M",
      driver: memoryDriver({
        files: { "/a.txt": "hello" },
      }),
    },
  ];
  app.route("/api/fm", createFmRouter({
    mounts: () => mounts,
  }));
  const seen: Headers[] = [];
  const c = createFmClient({
    baseUrl: "http://x/api/fm/",
    headers: () => ({ authorization: "Bearer t" }),
    fetch: async (input, init) => {
      seen.push(new Headers(init?.headers));
      return app.fetch(new Request(input, init));
    },
  });
  return { c, seen, app };
}

describe("fm client against the router", () => {
  it("round-trips the API", async () => {
    const { c, seen } = client();
    expect((await c.mounts()).map(m => m.id)).toEqual(["m"]);
    expect((await c.list("m", "/")).items.map(e => e.name)).toEqual(["a.txt"]);
    const { text, etag } = await c.readText("m", "/a.txt");
    expect(text).toBe("hello");
    await c.write("m", "/a.txt", "changed", { ifMatch: etag });
    await c.mkdir("m", "/dir");
    const res = await c.ops("m", {
      op: "move",
      paths: ["/a.txt"],
      dest: "/dir",
    });
    expect(res.results[0]!.entry!.path).toBe("/dir/a.txt");
    expect((await c.stat("m", "/dir/a.txt")).size).toBe(7);
    expect(seen.every(h => h.get("authorization") === "Bearer t")).toBe(true);
  });

  it("sends hidden / ignored only when off", async () => {
    const urls: string[] = [];
    const c = createFmClient({
      baseUrl: "http://x/api/fm",
      fetch: async (input) => {
        urls.push(input);
        return Response.json({ items: [] });
      },
    });
    await c.list("m", "/");
    await c.list("m", "/", { hidden: true, ignored: true });
    await c.list("m", "/", { hidden: false, ignored: false });
    await c.search("m", "/", "a");
    await c.search("m", "/", "a", { hidden: false, ignored: false });
    const query = urls.map(u => new URL(u).searchParams);
    expect(query.slice(0, 2).every(q => !q.has("hidden") && !q.has("ignored"))).toBe(true);
    expect([
      query[2]!.get("hidden"),
      query[2]!.get("ignored"),
    ]).toEqual(["0", "0"]);
    expect(query[3]!.has("hidden") || query[3]!.has("ignored")).toBe(false);
    expect([
      query[4]!.get("hidden"),
      query[4]!.get("ignored"),
    ]).toEqual(["0", "0"]);
  });

  it("reads a byte range through the client fetch", async () => {
    const { c, seen } = client();
    await c.write("m", "/r.txt", "0123456789");
    const { text } = await c.readText("m", "/r.txt", {
      range: { start: 0, end: 4 },
    });
    expect(seen.at(-1)!.get("range")).toBe("bytes=0-4");
    expect(text).toBe("01234");
  });

  it("reads raw bytes with a range and version", async () => {
    const { c, seen } = client();
    await c.write("m", "/x.txt", "0123456789");
    const res = await c.read("m", "/x.txt", {
      range: { start: 0, end: 3 },
      version: "v1",
    });
    expect(seen.at(-1)!.get("range")).toBe("bytes=0-3");
    expect(seen.at(-1)!.get("authorization")).toBe("Bearer t");
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("0123");
  });

  it("raises typed errors", async () => {
    const { c } = client();
    const err = await c.stat("m", "/missing").catch(e => e);
    expect(err).toBeInstanceOf(FmApiError);
    expect(err).toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(c.write("m", "/a.txt", "x", { ifMatch: "stale" })).rejects.toMatchObject({ status: 412 });
  });

  it("runs an upload session", async () => {
    const { c, app } = client();
    const session = await c.createUpload("m", { path: "/a.txt", size: 5 });
    expect(session).toMatchObject({
      mode: "chunked",
      path: "/a (1).txt",
      parts: 1,
      received: [],
    });
    const put = await app.fetch(new Request(c.uploadPartUrl("m", session.id, 1), {
      method: "PUT",
      headers: { "content-length": "5" },
      body: "12345",
    }));
    expect(put.status).toBe(200);
    expect((await c.getUpload("m", session.id)).received).toEqual([1]);
    expect(await c.completeUpload("m", session.id)).toMatchObject({ path: "/a (1).txt", size: 5 });
    await expect(c.getUpload("m", session.id)).rejects.toMatchObject({ status: 404 });

    const other = await c.createUpload("m", { path: "/b.txt", size: 1 });
    await c.abortUpload("m", other.id);
    await expect(c.getUpload("m", other.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("builds read and archive URLs", () => {
    const { c } = client();
    expect(c.readUrl("m", "/a b.txt", { download: true })).toBe("http://x/api/fm/m/m/read?path=%2Fa+b.txt&download=1");
    expect(c.archiveUrl("m", ["/a", "/b"])).toBe("http://x/api/fm/m/m/archive?path=%2Fa&path=%2Fb");
  });
});

describe("change messages", () => {
  it("sends the message on changing calls only, with per-call override", async () => {
    const app = new Hono();
    app.route("/api/fm", createFmRouter({
      mounts: () => [
        {
          id: "m",
          label: "M",
          driver: memoryDriver({
            files: { "/a.txt": "a" },
          }),
        },
      ],
    }));
    const seen: { url: string; message: string | null }[] = [];
    let current: string | undefined = "from host";
    const c = createFmClient({
      baseUrl: "http://x/api/fm",
      message: () => current,
      fetch: async (input, init) => {
        seen.push({
          url: new URL(input).pathname,
          message: new Headers(init?.headers).get("x-fm-message"),
        });
        return app.fetch(new Request(input, init));
      },
    });
    await c.list("m", "/");
    await c.write("m", "/a.txt", "b");
    await c.mkdir("m", "/d");
    await c.ops("m", {
      op: "delete",
      paths: ["/d"],
    }, { message: "override" });
    current = undefined;
    await c.write("m", "/a.txt", "c");
    expect(seen.map(s => [
      s.url.replace("/api/fm/m/m/", ""),
      s.message && decodeURIComponent(s.message),
    ])).toEqual([
      ["list", null],
      ["write", "from host"],
      ["mkdir", "from host"],
      ["ops", "override"],
      ["write", null],
    ]);
  });
});
