import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Hono } = await import("hono");
const { createFmClient } = await import("../client/client");
const { memoryDriver } = await import("../drivers/memory");
const { createFmRouter } = await import("../server/router");
const { FileManager } = await import("./file-manager");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout: give every element a size so the virtualizer has a viewport.
const sizes = [
  "clientHeight",
  "clientWidth",
  "offsetHeight",
  "offsetWidth",
] as const;
const saved = sizes.map(k => [
  k,
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, k),
] as const);
beforeAll(() => {
  for (const k of sizes) {
    Object.defineProperty(HTMLElement.prototype, k, {
      configurable: true,
      get: () => 400,
    });
  }
});
afterAll(async () => {
  for (const [k, d] of saved) {
    if (d)
      Object.defineProperty(HTMLElement.prototype, k, d);
  }
  await GlobalRegistrator.unregister();
});

describe("FileManager", () => {
  it("renders tree rows when it mounts again over cached listings", async () => {
    const app = new Hono();
    app.route("/fm", createFmRouter({
      mounts: () => [
        {
          id: "m",
          label: "Main",
          driver: memoryDriver({
            files: { "/a/x.txt": "x", "/b.txt": "b" },
          }),
        },
      ],
    }));
    const client = createFmClient({
      baseUrl: "http://localhost/fm",
      fetch: (input, init) => app.request(input, init),
    });
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const treeRows = () => [
      ...container.querySelectorAll("[role=treeitem]"),
    ].map(r => r.textContent);
    const settle = () => act(() => new Promise(r => setTimeout(r, 50)));
    const show = async () => {
      const root = createRoot(container);
      await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(FileManager, { client }))));
      return root;
    };

    // Cold mount: the listings arrive after the first commit.
    let root = await show();
    for (let i = 0; i < 20 && !treeRows().includes("b.txt"); i++)
      await settle();
    const rows = treeRows();
    expect(rows).toEqual(["Main", "a", "b.txt"]);
    act(() => root.unmount());

    // Warm mount: everything is cached, so no data change follows the first commit.
    root = await show();
    await settle();
    expect(treeRows()).toEqual(rows);
    act(() => root.unmount());
    container.remove();
  });
});
