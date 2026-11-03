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
{ "registries": { "@fm": "https://<registry-host>/r/{name}.json" } }
```

Then add what you need (dependencies are pulled in automatically):

```bash
bunx shadcn add @fm/fm-server @fm/fm-driver-local   # API side
bunx shadcn add @fm/fm-react                        # UI + client
```

| Item | Contents |
| --- | --- |
| `fm-core` | zod schemas, errors, path helpers |
| `fm-server` | Hono router (`createFileManager`), `Driver` interface, zip streaming |
| `fm-driver-memory` / `-local` / `-s3` | storage drivers (`local` is Bun-only) |
| `fm-driver-contract` | `bun:test` suite a new driver must pass |
| `fm-client` | typed fetch client, TanStack Query hooks, upload queue |
| `fm-react` | `<FileManager />`: tree, list/grid, previews, uploads |

Files land under `src/fm/`. Mount the router in the host API:

```ts
import { READ_ONLY_CAPS } from "@/fm/core/schema";
import { localDriver } from "@/fm/drivers/local";
import { createFileManager } from "@/fm/server/router";

app.route("/api/fm", createFileManager({
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
```

`readOnly` / `features` only hide UI actions. Enforce access on the server with
`readOnly` mounts or `authorize`.

### Writing a driver

Implement `Driver` from `src/fm/server/driver.ts` and run the contract suite:

```ts
import { runDriverContract } from "@/fm/server/contract";

runDriverContract("my-driver", async () => ({ driver: myDriver(), cleanup: async () => {} }));
```

## Development

```bash
bun install
bun run check            # lint + typecheck + tests + registry build + app builds
bun run test:e2e         # Playwright against the demo (builds demo-web, serves it from demo-api)
bun run registry:smoke   # shadcn add every item into a scratch app, typecheck + build (needs network)
FM_TEST_S3_ENDPOINT=http://localhost:9000 bun test registry   # include the S3 driver contract
```

Demo (two processes, routed by nsl at `fm.localhost:3355`):

```bash
cd apps/demo-api && bun run dev
cd apps/demo-web && bun run dev
```
