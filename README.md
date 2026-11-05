# filemanager

A generic file manager — Hono backend router + React UI — distributed as a
[shadcn registry](https://ui.shadcn.com/docs/registry). Host apps copy the
code in with `shadcn add` and own it from then on.

Storage backends are **drivers** behind one interface: `memory`, `local`
(Bun), `s3` (Bun + Cloudflare Workers) and `r2` (Workers binding) ship today.

See [`docs/architecture.md`](docs/architecture.md) for the design.

## Install into a host app

Register the namespace in the host's `components.json`:

```json
{ "registries": { "@bkhq": "https://bkhq.github.io/filemanager/r/{name}.json" } }
```

`/r/` is the latest release. To pin a release, use its tag in the path, e.g.
`https://bkhq.github.io/filemanager/v0.1.0/r/{name}.json`; `/next/r/` tracks `main`.

Then add what you need (dependencies are pulled in automatically):

```bash
bunx shadcn add @bkhq/fm-server @bkhq/fm-driver-local   # API side
bunx shadcn add @bkhq/fm-react                        # UI + client
```

| Item | Contents |
| --- | --- |
| `fm-core` | zod schemas, errors, path helpers |
| `fm-server` | Hono router (`createFmRouter`), `FmDriver` interface, zip streaming |
| `fm-driver-memory` / `-local` / `-s3` / `-r2` | storage drivers (`local` is Bun-only, `r2` needs a Workers R2 binding) |
| `fm-driver-contract` | `bun:test` suite a new driver must pass |
| `fm-client` | typed fetch client, TanStack Query hooks, upload queue |
| `fm-react` | `<FileManager />`: tree, list/grid, previews (image / video rotate, flip, zoom), uploads, trash, undo |
| `fm-plugin-sheet` | optional plugin: CSV / TSV / XLSX table (virtualized rows, typed cells); CSV / TSV cells editable and saved with `If-Match` |
| `fm-plugin-archive` | optional plugin: browse `.zip` / `.jar` without extracting (folder tree, inline text / image preview, per-entry download) via `GET /m/:mount/zip/entries` and `/zip/read` |
| `fm-plugin-markdown` | optional plugin: Markdown opens in the editor with a live rendered preview (streamdown: GFM, highlighted code) |

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
  // Optional: one event per mutated item (write, delete, rename, ...), success or failure.
  onEvent: (c, e) => console.log(e.op, e.mount, e.path, e.ok),
}));
```

Local driver options:

| Option | Effect |
| --- | --- |
| `root` | absolute directory served as the mount root |
| `readOnly` | expose read-only capabilities |
| `showHidden` | `false` drops dotfiles everywhere (default `true`) |
| `gitIgnore` | search via `git ls-files`; listings mark `ignored` entries via `git check-ignore`; writes into `.git` are refused |
| `uploadDir` | directory for in-progress multipart parts (default `<root>/.fm-uploads/parts`) |

Render the UI inside a `QueryClientProvider`:

```tsx
import { FileManager } from "@/fm/react/file-manager";

<FileManager baseUrl="/api/fm" />;

// View only: browse, preview, search, download.
<FileManager baseUrl="/api/fm" readOnly />;

// Per-feature switches on top of the preset (see `src/fm/react/features.ts`).
<FileManager baseUrl="/api/fm" features={{ delete: false, upload: false }} />;

// Start without the folder tree; users can toggle it. Below 640px it is always single-pane.
// The tree and details panes are resizable (drag or arrow keys); sizes persist per `storageKey`.
<FileManager baseUrl="/api/fm" layout="single" />;
```

`readOnly` / `features` only hide UI actions. Enforce access on the server with
`readOnly` mounts or `authorize`.

Dragging a file row onto the desktop (Chromium) downloads it from its read URL
without the client's `headers`, so it only works when the API authenticates by
cookie or not at all.

### Starred and recent

The component keeps no per-user data. Hosts that have it (their own database,
or `localStorage` as in `apps/fm-web`) pass `meta`; each part is optional and
its UI appears only when provided:

```tsx
import type { FmMeta } from "@/fm/react/meta";

const meta: FmMeta = {
  starred: () => api.starred(),                   // FmRef[] = { mount, path }[]
  setStarred: (ref, on) => api.setStarred(ref, on), // "Add to starred" in context menus
  recent: () => api.recent(),
  touch: ref => api.opened(ref),                  // called when a file is opened
};

<FileManager baseUrl="/api/fm" meta={meta} />;
```

Starred / Recent show as tree sections (and in the Storage menu of the single
layout); up to 50 entries each, resolved with `stat`. Hosts switch either off
with `features={{ starred: false }}` / `{ recent: false }`; users hide the
sections from the explorer's More menu (remembered per browser). Type / modified filters
work on the loaded entries of a folder (500 per page).

### Plugins

Optional file-type support is shipped as plugins: extra previewers and
context-menu actions.

```tsx
import { archivePlugin } from "@/fm/plugins/archive";   // bunx shadcn add @bkhq/fm-plugin-archive
import { markdownPlugin } from "@/fm/plugins/markdown"; // bunx shadcn add @bkhq/fm-plugin-markdown
import { sheetPlugin } from "@/fm/plugins/sheet";       // bunx shadcn add @bkhq/fm-plugin-sheet

<FileManager baseUrl="/api/fm" plugins={[sheetPlugin(), markdownPlugin(), archivePlugin()]} />;
```

The Markdown plugin renders with streamdown, whose classes Tailwind must see.
Add to the host's CSS (paths relative to that file):

```css
@source "../node_modules/streamdown/dist/*.js";
@source "../node_modules/@streamdown/code/dist/*.js";
```

A plugin is a plain object (`FmPlugin` in `src/fm/react/plugins.ts`):

```tsx
const logPlugin: FmPlugin = {
  id: "log",
  previewers: [{
    id: "log",
    match: e => e.name.endsWith(".log"),
    component: lazy(() => import("./log-view")),        // receives PreviewProps
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

### Large uploads

Files of 16 MiB and more (`sessionThreshold` of the client upload queue) go
through resumable upload sessions: numbered parts, per-part retry, resume
after a reload. Session records and server-side parts live in a hidden
`/.fm-uploads` folder per mount. Tune them with router `limits`:

```ts
createFmRouter({
  mounts,
  limits: {
    uploadPartSize: 8 * 1024 * 1024,                // default 8 MiB; drivers may require larger parts
    maxSessionUploadBytes: 10 * 1024 * 1024 * 1024, // default 10 GiB per session
    uploadSessionTtlMs: 24 * 60 * 60 * 1000,         // default 24 h, then the session is swept
  },
});
```

Trash: `trash: true` moves deletes into a hidden `/.fm-trash` folder on the
same storage. `trash: { retentionDays: 30 }` also deletes items older than
that for good, lazily whenever the trash is listed; hosts that prefer a
schedule call `purgeExpired(mount)` (from `@/fm/server/router`) from a cron job.

Thumbnails: the grid view asks `GET /m/:mount/thumb?path&w=128|256|512` when
the router has a `thumbnail` hook, and falls back to the full image otherwise.

```ts
import { bunThumbnail } from "@/fm/thumbnails/bun";             // bunx shadcn add @bkhq/fm-thumbnail-bun
createFmRouter({ mounts, thumbnail: bunThumbnail() });          // Bun.Image, no dependency

import { cloudflareThumbnail } from "@/fm/thumbnails/cloudflare"; // bunx shadcn add @bkhq/fm-thumbnail-cloudflare
createFmRouter<Env>({ mounts, thumbnail: cloudflareThumbnail<Env>(c => c.env.IMAGES) }); // "images": { "binding": "IMAGES" }
```

Saving a rotated / flipped image from the preview re-encodes it in the browser
(PNG / JPEG / WebP, same type) and drops its metadata such as EXIF.

On S3 parts go through the server by default. `s3Driver({ ..., presignUploads: true })`
is opt-in and lets browsers `PUT` parts straight to the bucket via presigned
URLs. It requires both:

- an S3 endpoint reachable from the browser (internal endpoints such as
  `http://rustfs:9000` do not work);
- bucket CORS allowing the upload and exposing the part ETag:

  ```json
  [{
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"]
  }]
  ```

### Cloudflare Workers

```bash
bunx shadcn add @bkhq/fm-server @bkhq/fm-driver-r2
```

Pass the R2 binding to the driver (`FM_BUCKET` is an `r2_buckets` binding in `wrangler.jsonc`):

```ts
import { Hono } from "hono";
import { r2Driver } from "@/fm/drivers/r2";
import { createFmRouter } from "@/fm/server/router";

interface Env { Bindings: { FM_BUCKET: R2Bucket } }

const app = new Hono<Env>();

app.route("/api/fm", createFmRouter<Env>({
  mounts: c => [{ id: "r2", label: "R2 bucket", driver: r2Driver({ bucket: c.env.FM_BUCKET }), trash: true }],
}));

export default app;
```

`apps/fm-worker` is a complete example that also serves the built `fm-web` UI:

```bash
bun run --filter @bkhq/fm-web build
cd apps/fm-worker && bunx wrangler dev        # local R2 emulation, no Cloudflare account needed
bun run --filter @bkhq/fm-worker build        # wrangler deploy --dry-run --outdir dist
```

The R2 driver contract runs under `bun test` against miniflare's local R2, so
development needs no real account.

> [!WARNING]
> `apps/fm-worker` mounts `/api/fm` with read, write and delete on the whole
> bucket and no authentication (like `apps/fm-api`). Before any real deploy put
> one of these in front of `/api/fm/*`: Cloudflare Access (verify the
> `Cf-Access-Jwt-Assertion` header), a bearer-token middleware whose token is a
> Wrangler secret, or `createFmRouter`'s `authorize` hook.

### Writing a driver

Implement `FmDriver` from `src/fm/server/driver.ts` and run the contract suite:

```ts
import { runDriverContract } from "@/fm/server/contract";

runDriverContract("my-driver", async () => ({ driver: myDriver(), cleanup: async () => {} }));
```

## Publishing

The Registry workflow (`.github/workflows/registry.yml`) deploys to GitHub Pages:
a push to `main` updates `/next/r/`; pushing a `v*` tag publishes `/v{version}/r/`
and moves `/r/` to it. One-time setup: enable GitHub Pages (Settings -> Pages ->
Source: GitHub Actions), then allow tag deploys (Settings -> Environments ->
github-pages -> Deployment branches and tags -> add tag rule `v*`).

Items are copied source, so upgrading a host means re-running `shadcn add` for its
items (against `/r/` or a newer pinned version) and reviewing the diff.

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

Dev apps (two processes, routed by nsl at `fm.localhost:3355`; `nsl` is a global CLI, not a dependency):

```bash
cd apps/fm-api && bun run dev
cd apps/fm-web && bun run dev
```
