import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { memoryDriver } from "../drivers/memory";
import { createFileManager } from "../server/router";
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
  app.route("/api/fm", createFileManager({
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
  return { c, seen };
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

  it("raises typed errors", async () => {
    const { c } = client();
    const err = await c.stat("m", "/missing").catch(e => e);
    expect(err).toBeInstanceOf(FmApiError);
    expect(err).toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(c.write("m", "/a.txt", "x", { ifMatch: "stale" })).rejects.toMatchObject({ status: 412 });
  });

  it("builds read and archive URLs", () => {
    const { c } = client();
    expect(c.readUrl("m", "/a b.txt", { download: true })).toBe("http://x/api/fm/m/m/read?path=%2Fa+b.txt&download=1");
    expect(c.archiveUrl("m", ["/a", "/b"])).toBe("http://x/api/fm/m/m/archive?path=%2Fa&path=%2Fb");
  });
});
