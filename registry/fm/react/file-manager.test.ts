import type { createRoot as CreateRoot } from "react-dom/client";
import type { FileManager as FileManagerComponent } from "./file-manager";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Hono } from "hono";
import { act, createElement } from "react";
import { createFmClient } from "../client/client";
import { memoryDriver } from "../drivers/memory";
import { createFmRouter } from "../server/router";

// The DOM exists only while this file runs: other test files share the process and its globals.
let createRoot: typeof CreateRoot;
let FileManager: typeof FileManagerComponent;
beforeAll(async () => {
  GlobalRegistrator.register({ url: "http://localhost/" });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom has no layout: give every element a size so the virtualizer has a viewport.
  for (const k of [
    "clientHeight",
    "clientWidth",
    "offsetHeight",
    "offsetWidth",
  ]) {
    Object.defineProperty(HTMLElement.prototype, k, {
      configurable: true,
      get: () => 400,
    });
  }
  // react-dom checks for a DOM when it loads.
  ({ createRoot } = await import("react-dom/client"));
  ({ FileManager } = await import("./file-manager"));
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
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

  it("ends the entry menu of a read-only file without a separator", async () => {
    const app = new Hono();
    app.route("/fm", createFmRouter({
      mounts: () => [
        {
          id: "m",
          label: "Main",
          readOnly: true,
          driver: memoryDriver({
            files: { "/b.txt": "b" },
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
    const settle = () => act(() => new Promise(r => setTimeout(r, 50)));
    const root = createRoot(container);
    await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(FileManager, { client }))));
    const row = () => [
      ...container.querySelectorAll("[role=treeitem]"),
    ].find(r => r.textContent === "b.txt");
    for (let i = 0; i < 20 && !row(); i++)
      await settle();
    await act(async () => {
      row()!.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }));
    });
    await settle();
    const menu = document.querySelector("[data-slot=context-menu-content]");
    expect(menu?.textContent).toContain("Details");
    expect(menu?.lastElementChild?.getAttribute("data-slot")).not.toBe("context-menu-separator");
    act(() => root.unmount());
    container.remove();
  });
});
