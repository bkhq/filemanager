# filemanager

A generic file manager — Hono backend router + React UI — distributed as a
[shadcn registry](https://ui.shadcn.com/docs/registry). Host apps copy the
code in with `shadcn add` and own it from then on.

Storage backends are **drivers** behind one interface: `memory`, `local`
(Bun) and `s3` (Bun + Cloudflare Workers) ship today.

See [`docs/architecture.md`](docs/architecture.md) for the design.

## Install into a host app

Register the namespace in the host's `components.json`:

```json
{ "registries": { "@bkhq": "https://<registry-host>/r/{name}.json" } }
```

Then add what you need (dependencies are pulled in automatically):

```bash
bunx shadcn add @bkhq/fm-server @bkhq/fm-driver-local   # API side
bunx shadcn add @bkhq/fm-react                        # UI + client
```

| Item | Contents |
| --- | --- |
| `fm-core` | zod schemas, errors, path helpers |
| `fm-server` | Hono router (`createFmRouter`), `FmDriver` interface, zip streaming |
| `fm-driver-memory` / `-local` / `-s3` | storage drivers (`local` is Bun-only) |
| `fm-driver-contract` | `bun:test` suite a new driver must pass |
| `fm-client` | typed fetch client, TanStack Query hooks, upload queue |
| `fm-react` | `<FileManager />`: tree, list/grid, previews (image / video rotate, flip, zoom), uploads, trash, undo |
| `fm-plugin-sheet` | optional plugin: CSV / TSV / XLSX table preview |

Files land under `src/fm/`. Mount the router in the host API:

```ts
import { READ_ONLY_CAPS } from "@/fm/core/schema";
import { localDriver } from "@/fm/drivers/local";
import { createFmRouter } from "@/fm/server/router";

app.route("/api/fm", createFmRouter({
  // Resolved per request: scope mounts to the current user / project here.
  mounts: () => [{ id: "files", label: "Files", driver: localDriver({ root: "/data/files" }) }],
  // Optional host policy for a path and everything below it; no `read` answers 404.
  authorize: (c, { path }) => READ_ONLY_CAPS,
}));
```

Render the UI inside a `QueryClientProvider`:

```tsx
import { FileManager } from "@/fm/react/file-manager";

<FileManager baseUrl="/api/fm" />;

// View only: browse, preview, search, download.
<FileManager baseUrl="/api/fm" readOnly />;

// Per-feature switches on top of the preset (see `src/fm/react/features.ts`).
<FileManager baseUrl="/api/fm" features={{ delete: false, upload: false }} />;

// Start without the folder tree; users can toggle it. Below 640px it is always single-pane.
<FileManager baseUrl="/api/fm" layout="single" />;
```

`readOnly` / `features` only hide UI actions. Enforce access on the server with
`readOnly` mounts or `authorize`.

### Plugins

Optional file-type support is shipped as plugins: extra previewers and
context-menu actions.

```tsx
import { sheetPlugin } from "@/fm/plugins/sheet";   // bunx shadcn add @bkhq/fm-plugin-sheet

<FileManager baseUrl="/api/fm" plugins={[sheetPlugin()]} />;
```

A plugin is a plain object (`FmPlugin` in `src/fm/react/plugins.ts`):

```tsx
const markdownPlugin: FmPlugin = {
  id: "markdown",
  previewers: [{
    id: "markdown",
    match: e => e.name.endsWith(".md"),
    component: lazy(() => import("./markdown-view")),   // receives PreviewProps
    priority: 10,                                        // beats the built-in text editor
  }],
  actions: [{
    id: "word-count",
    label: "Count words",
    when: entries => entries.length === 1 && entries[0]!.kind === "file",
    run: async ([entry], ctx) => {
      const { text } = await ctx.client.readText(entry!.mount, entry!.path);
      alert(text.split(/\s+/).length);
    },
  }],
};
```

Previewers get `actions` (an element in the preview header to portal buttons
into) and `onDirtyChange` (to guard unsaved edits). Actions get `ctx` with the
client, current mount / path, `refresh`, `preview` and `fail`.

### Writing a driver

Implement `FmDriver` from `src/fm/server/driver.ts` and run the contract suite:

```ts
import { runDriverContract } from "@/fm/server/contract";

runDriverContract("my-driver", async () => ({ driver: myDriver(), cleanup: async () => {} }));
```

## Development

```bash
bun install
bun run check            # lint + typecheck + tests + registry build + app builds
bun run test:e2e         # Playwright against the built app (builds fm-web, serves it from fm-api)
bun run registry:smoke   # shadcn add every item into a scratch app, typecheck + build (needs network)
FM_TEST_S3_ENDPOINT=http://localhost:9000 bun test registry   # include the S3 driver contract
```

Repository map for maintainers:

| Path | What lives there |
| --- | --- |
| `registry/fm/*` | everything shipped to hosts; `core` / `server` / `client` / `drivers` (except `local`) must stay Web-API only (lint-enforced) so they run on Bun and Workers |
| `registry.json` | registry items; add every new shipped file here or `shadcn add` will miss it (`registry:smoke` catches this) |
| `apps/fm-api`, `apps/fm-web` | dev / e2e host; `seed.ts` fills `.tmp/fm-root` once when empty |
| `tests/e2e` | Playwright flows against the built app |
| `docs/architecture.md` | design and API surface; `docs/changelog.md` records decisions and pitfalls |

Dev apps (two processes, routed by nsl at `fm.localhost:3355`):

```bash
cd apps/fm-api && bun run dev
cd apps/fm-web && bun run dev
```
