# Filemanager — Generic File Manager Component

A reusable file manager made of a **backend router** and a **React UI**, meant
to be embedded into host apps (bithk-based projects, bkd, future tools) instead
of each app growing its own file browser.

## 0. Decisions

| Topic | Decision |
| --- | --- |
| Distribution | shadcn-style copy: sources are published as a shadcn registry under the `@bkhq` namespace (hosts add `"registries": { "@bkhq": "<url>/r/{name}.json" }` to `components.json`, then `bunx shadcn add @bkhq/fm-react`) and own the copied code. No npm packages. |
| Managed storage | Generic `managed` store with its own tables, so any app can adopt it; bithk migrates onto it later. |
| Standalone app | Not a target. The `fm-api` / `fm-web` apps exist for development and e2e only. |
| Runtime | Server code runs on **Bun** and **Cloudflare Workers**. Core and router use Web-standard APIs only; runtime-specific drivers live in separate files. |

## 1. Prior art

### 1.1 In-house

| Project | Model | Strengths to keep | Gaps |
| --- | --- | --- | --- |
| **zzci/bithk** `drive` + `file` modules | DB-indexed virtual tree (`drive_entries`) over content-addressed blobs (`files` / `file_references`), drivers `db` / `local` / `s3` | sha256 dedupe + refcount GC; permission hooks keyed by `owner_type`; presigned S3 download + direct upload; versions with pinned display version; trash + retention sweep; streamed zip archive; thumbnail cache; `DriveFileListSurface` (presentational, `actions` bag + `capabilities` flags, grid/list, rubber-band select, context menus, infinite paging); XHR upload queue with progress | Bound to bithk's users / policy / project tables; cannot browse an existing directory or bucket; UI is drive-specific |
| **bkhq/bkd** `files` / `filesystem` routes | Direct path-based access to a real directory (workspace / git worktree) | Root jail + `realpath` symlink check; base58-encoded root in URL; binary sniff; `git check-ignore` filtering; trash dir with 7-day purge; CodeMirror editor with drafts + `baseModifiedAt` conflict check; virtualized tree (`@tanstack/react-virtual`); quick-open | Single local backend; text-only 1 MB editing cap; no capabilities model; ad-hoc URL scheme (`/{root}/show/{path}`) |
| **zzci/drive** | Packaged Cloudreve 4.x | Full product UX reference | Closed-feature Pro license key; not embeddable |

### 1.2 Open source

| Project | What to borrow | Why not adopt directly |
| --- | --- | --- |
| **OpenList** (AList fork, Go + SolidJS, AGPL-3.0) | Mount table aggregating many storage drivers under one namespace; per-driver capability flags | AGPL; whole app, not a component; fork still stabilising |
| **FileBrowser Quantum** (Go) | Multiple named sources with include/exclude rules; SQLite index for instant search + folder sizes | App, not a library; upstream File Browser maintenance status unverified |
| **Filestash** | Pluggable storage backends + auth plugins | App; heavy |
| **Cloudreve** | Product-level UX: share links, upload sessions, thumbnails, offline download | Licensing, app |
| **SVAR React File Manager** (MIT) | `RestDataProvider` pattern: UI emits operations, a provider talks to backend; preview pane; copy/cut/paste | Own styling system; does not match the shadcn baseline we lock to |
| **Apache OpenDAL / rclone VFS** | One storage API over local / S3 / SFTP / WebDAV / …; capability matrix per service | Rust / Go; we only borrow the interface shape |
| **tus + Uppy** | Resumable upload protocol; `@uppy/aws-s3` multipart direct-to-S3 | Use as transport, not as UI |

Conclusion: no existing project is both **embeddable** and **compatible with our
stack** (Bun + Hono + React + TanStack + shadcn). Build our own, combining
bithk's storage/permission model, bkd's path-jail safety, OpenList's mount
table, and SVAR's provider-driven UI.

## 2. Goals / non-goals

Goals

- One wire protocol and one UI for two storage styles:
  - **Path drivers** — browse what already exists (local dir, git worktree, S3 bucket/prefix, later SFTP/WebDAV).
  - **Managed driver** — DB-indexed tree with dedupe, versions, trash (bithk-style).
- Host app owns identity and authorization; the component only asks via hooks.
- Capability-driven UI: the server advertises what a mount/entry can do, the UI hides what it can't.
- Embeddable pieces: full manager page, side drawer (bkd), file picker dialog, attachment list.

Non-goals (v1)

- User / team / share management (host app owns them; exposed via hooks and UI slots).
- Office document editing, offline download, media transcoding.
- Desktop sync clients, WebDAV server endpoint.
- Standalone deployable product with its own auth.

## 3. Architecture

### 3.0 Repository layout and distribution

The repo is a Bun workspace whose real product is a **shadcn registry**. Source
lives under `registry/` with the same `@/` alias layout a host app uses, so the
copied files compile unchanged in the host.

```text
registry/
  fm/core/        zod schemas, FmEntry / FmCaps / FmError types, path utils (pure TS, no IO)
  fm/server/      Hono router factory, FmDriver interface, contract suite    (Web APIs only)
  fm/drivers/     memory.ts, local.ts (Bun: node:fs), s3.ts (fetch + SigV4, Bun + Workers), r2.ts (Workers binding)
  fm/managed/     managed driver: Drizzle schema (SQLite / D1), service, GC
  fm/client/      typed fetch client, TanStack Query hooks, upload engine
  fm/react/       UI on shadcn/ui (base-nova) + Tailwind
registry.json     shadcn registry manifest. Shipped: fm-core, fm-server, fm-driver-contract, fm-driver-memory,
                  fm-driver-local, fm-driver-s3, fm-client, fm-react. Planned: fm-driver-r2, fm-managed.
                  Items depend on each other via `@bkhq/<item>` registryDependencies.
apps/
  fm-api/         Bun + Hono host consuming registry/ via path aliases (dev + e2e)
  fm-web/         React + Vite host consuming registry/ via path aliases
  fm-worker/      Cloudflare Workers host (wrangler) running the same router with r2 / s3
public/r/         `shadcn build` output served as the registry
```

Copy semantics: a host installs once and owns the code; upgrades are re-running
`shadcn add` and reviewing the diff. Every item therefore keeps a small,
stable surface and a header-free layout (no generated banners) so diffs stay
readable.

Dependency direction: `core` ← `server` ← `drivers` / `managed`; `core` ← `client` ← `react`.

### 3.0.1 Runtime rules

- `core`, `server`, `client`, `managed` service: Web-standard APIs only
  (`Request` / `Response` / `ReadableStream` / `crypto.subtle` / `fetch`), no
  `Bun.*`, no `node:*`. Checked by a lint rule (`no-restricted-imports` /
  globals) plus a Workers build of `fm-worker` in CI.
- `drivers/local.ts` is Bun-only (`node:fs`). `drivers/s3.ts` signs with
  SigV4 over `fetch` so it runs on both. `drivers/r2.ts` uses the Workers R2
  binding.
- `managed` takes a Drizzle SQLite database; Bun passes `bun:sqlite`, Workers
  passes D1. No interactive transactions are relied on (D1 has none): writes
  use `db.batch` / single statements with conditional updates.
- Thumbnails are a host hook (`thumbnail(entry, width) → Response | null`):
  Bun hosts can use `Bun.Image`, Workers hosts Cloudflare Images.
- No long-running server jobs (Workers request limits). Batch ops are bounded
  per request; the client drives multi-request work (cross-mount copy, large
  deletes) and shows progress itself.

### 3.0.2 Naming

Copied files share the host's namespace, so shipped names avoid generic words.

| Kind | Rule | Examples |
| --- | --- | --- |
| Registry namespace / items | `@bkhq/fm-<area>[-<name>]` | `@bkhq/fm-react`, `@bkhq/fm-driver-s3` |
| Exported types and interfaces under `registry/fm` | `Fm` prefix; React `*Props` exempt (lint-enforced) | `FmEntry`, `FmDriver`, `FileManagerProps` |
| Server factory | `createFmRouter`, options `FmRouterOptions` | |
| Client | `createFmClient`, hooks `useXxx` | `useListing`, `useFmMutations` |
| Drivers / plugins | `<name>Driver()`, `<name>Plugin()` | `localDriver`, `sheetPlugin` |
| React components | descriptive, no prefix | `FileManager`, `FilePicker`, `FileDrawer` |
| Values, functions, zod schemas | camelCase / UPPER_CASE, no prefix | `entrySchema`, `READ_ONLY_CAPS` |
| Runtime identifiers | `fm` / `fm-` / `FM_` | `.fm-trash`, `application/x-fm-paths`, `FM_ROOT` |
| Terms | driver, mount, entry (not provider) | |

### 3.1 Addressing

Every entry is addressed by `(mount, path)`. Paths are POSIX, normalised,
always relative to the mount root (`/` = root). Managed mounts additionally
expose a stable `id` so renames don't break references.

```ts
interface FmEntry {
  mount: string;
  path: string;              // "/docs/a.md"
  id?: string;               // stable id (managed driver only)
  name: string;
  kind: "file" | "dir";
  size?: number;             // dirs: optional (indexed drivers only)
  mtime: string;             // ISO
  mime?: string;
  etag: string;              // optimistic concurrency token
  caps: EntryCaps;           // effective capabilities for the caller
  meta?: Record<string, unknown>; // driver extras: favorite, version count, git-ignored…
}
```

`etag` unifies bkd's `baseModifiedAt` and bithk's `version`: writes, renames
and deletes accept `If-Match`, conflicts return `412 ETAG_MISMATCH`.

### 3.2 `FmDriver` interface (server)

```ts
interface FmDriver {
  readonly kind: string;                       // "local" | "s3" | "managed" | …
  readonly caps: DriverCaps;                 // static: rename, move, copy, trash, versions, search, presign, watch, multipart
  stat(path): Promise<FmEntry>;
  list(path, opts: { cursor?, limit, sort, showHidden }): Promise<{ items: FmEntry[]; cursor?: string }>;
  read(path, range?): Promise<FmReadResult>;     // stream + size + mime; supports Range
  write(path, body: ReadableStream, opts: { ifMatch?, overwrite }): Promise<FmEntry>;
  mkdir(path): Promise<FmEntry>;
  move(from, to, opts): Promise<FmEntry>;        // same-mount; cross-mount is a job (copy + delete)
  copy?(from, to, opts): Promise<FmEntry>;
  remove(path, opts: { permanent }): Promise<void>; // trash when caps.trash
  search?(q, opts): Promise<FmEntry[]>;
  presignRead?(path, opts): Promise<string>;
  upload?: UploadSessionApi;                   // multipart / resumable sessions
  trash?: TrashApi;                            // list / restore / purge
  versions?: VersionApi;                       // list / restore / pin
  watch?(path): AsyncIterable<ChangeEvent>;
}
```

Built-in drivers:

- **local** — ported from bkd: root jail, `realpath` symlink check, atomic
  `tmp → rename` writes, trash dir under the data dir, optional `.gitignore`
  awareness (`meta.ignored`).
- **s3** — SigV4 over `fetch` (Bun + Workers); prefix as root; presigned GET;
  multipart upload sessions; dirs are virtual (common prefixes); rename =
  copy + delete, bounded per request.
- **r2** — Workers R2 binding; same semantics as `s3`, plus native multipart.
- **memory** — for tests and the playground.
- **managed** (`fm/managed`) — bithk's model generalised: `fm_entries`
  (tree), `fm_blobs` (sha256, driver, key, ref_count), `fm_versions`; blobs
  stored through a nested driver (local, s3 or r2); SQLite via `bun:sqlite` or D1. Gains dedupe, versions,
  trash, favorites, server-side paging and search.

### 3.3 Mounts and host hooks

```ts
createFmRouter({
  mounts: async (ctx) => [                      // resolved per request → per-user / per-project mounts
    { id: "ws", label: "Workspace", driver: local({ root: "/work/foo" }) },
    { id: "drive", label: "My files", driver: managed({ db, owner: ctx.user.id, blobs: s3(...) }) },
  ],
  authorize: async (ctx, action, target) => boolean | FmCaps, // host policy (Zanzibar, project roles…)
  onEvent?: (ctx, event: FmChangeEvent) => void | Promise<void>,
  limits: { maxUploadBytes, maxEditBytes, archiveMaxBytes, archiveMaxEntries },
});
// → Hono sub-app, host mounts it: app.route("/api/fm", fm.routes)
```

- `FmChangeEvent` = `{ op, mount, path, to?, toMount?, trashId?, ok, error? }`; `op` is
  `write | mkdir | delete | rename | move | copy | restore | purge`, `error` is
  `{ code, message }` when `ok` is false. `toMount` is the destination mount id,
  set only on cross-mount move / copy items.
- Fired once per item after the operation, on success or failure; batch items
  in request order. A delete into trash carries the new `trashId`; restore and
  purge carry the `trashId` they acted on (`path` is the item's original path).
- The hook is awaited, so hosts can write audit rows transactionally; an error
  it throws is logged and never changes the response.
- Effective caps = `driver.caps ∩ authorize(...)`; returned on every `FmEntry`.
- Fail-closed: unknown mount or denied read → `404` (bithk ADR-003 behaviour).
- Unknown/unsafe MIME for inline (`html`, `svg`, `js`) → served as attachment / octet-stream (bithk rule).

### 3.4 HTTP API

All under the host prefix, mount id in the path, entry path in the query
(avoids bkd's URL-marker parsing and base58 roots).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/mounts` | Mounts visible to caller + driver caps |
| GET | `/m/:mount/stat?path=` | |
| GET | `/m/:mount/list?path=&cursor=&limit=&sort=&dir=&q=` | Cursor paging, dirs first, `q` = name filter of direct children |
| GET | `/m/:mount/usage?path=` | Folder size `{ bytes, files, dirs, truncated }`, walk capped by `archiveMaxEntries` |
| GET | `/m/:mount/read?path=&inline=&thumb=` | Range, ETag, presign 302 when allowed, `thumb` widths whitelist |
| PUT | `/m/:mount/write?path=` | Small writes / editor save, `If-Match` |
| POST | `/m/:mount/mkdir` | `{ path }` |
| POST | `/m/:mount/ops` | Batch `{ op: move/copy/delete/rename, items, dest, destMount?, conflict: "fail"/"rename"/"overwrite" }`; bounded size, per-item results. A `destMount` other than `:mount` streams content between the two drivers file by file: `copy`/`move` on the source and `write` on the destination are authorized, the walk is bounded by `archiveMaxEntries` / `archiveMaxBytes` before anything is written, a failed item removes its partial copy, and `move` deletes the source (to the trash when enabled) only after the whole copy landed. Such a copy runs inside one request, so on Workers it can hit the request-duration limit; the walk limits bound it |
| GET | `/m/:mount/search?q=` | Driver search or fallback walk with limits |
| POST | `/m/:mount/archive` | Streamed zip (fflate passthrough, caps from bithk) |
| POST | `/m/:mount/uploads` | Create session → `{ mode: "put" / "chunked" / "s3-multipart", partSize, urls? }` |
| PUT | `/m/:mount/uploads/:id/parts/:n` | Chunk (non-presigned modes) |
| POST | `/m/:mount/uploads/:id/complete` | Optional sha256 for dedupe/verify |
| GET/POST | `/m/:mount/trash`, `/trash/restore`, `/trash/purge` | When the mount sets `trash: true`. Implemented in the router on top of any driver: `/.fm-trash/<id>/<name>` + `<id>.json`, hidden from every other route; items are authorized against their original path. A driver-native `TrashApi` (managed store) can replace it later |
| GET/POST | `/m/:mount/versions?path=`, `/versions/restore` | When `caps.versions` |
| GET | `/m/:mount/watch?path=` (SSE) | When `caps.watch` (local via fs.watch; Bun only) |

Upload: own simple chunked protocol (resume = query received parts) rather
than full tus, so S3 multipart and local chunk assembly share one client path.
The client hashes with sha256 in a worker only when the mount reports
`caps.dedupe` (bithk's instant-upload trick).

OpenAPI via `hono-openapi` per the pma-bun baseline; the client is typed
from the same zod schemas in `fm/core`.

## 4. UI (`fm/react`)

Layered so hosts can take only what they need:

1. **Headless state** — `useFileManager({ client, mount, path })`: navigation
   history, selection (incl. shift-range), sort, view mode, clipboard
   (cut/copy/paste), drag-and-drop targets, keyboard map. No markup.
2. **Primitives** (shadcn-based): `FileTree` (virtualized, lazy), `FileList`
   (list + grid, virtualized, rubber-band select), `Breadcrumb`, `Toolbar`,
   `ContextMenu`, `BatchBar`, `UploadQueue`, `DropZone`, `ConflictDialog`,
   `PropertiesPanel`.
3. **Compositions** — `<FileManager />` (tree + list + preview pane),
   `<FileDrawer />` (bkd side panel), `<FilePicker />` (dialog returning
   entries; replaces bithk `DriveFilePicker`), `<AttachmentList />`.

Extension points:

- **Preview registry**: `registerPreviewer({ match: (entry) => bool, component, priority })`.
  Built-ins: image (thumb + full), pdf, video/audio, text/code (CodeMirror, from bkd),
  markdown, unknown → download. Hosts add e.g. Univer spreadsheet.
- **Editor registry**: text/code editor with draft persistence and `etag` conflict handling.
- **Actions**: `getActions(entries) => FmFileAction[]` merged into toolbar / context menu
  (bithk's `getCustomActions`, generalised to multi-select); host adds Share, Attach to issue…
- **Slots**: sidebar footer (quota), header extras, empty state, row badges.
- **i18n**: `enLabels` / `zhLabels` objects passed as the `labels` prop; no i18n library dependency.

Everything visible is gated by `entry.caps`, not by props flags — removing
bithk's per-consumer `capabilities` duplication.

## 5. Migration of existing apps

| App | Path |
| --- | --- |
| bkd | Replace `routes/files.ts` + `filesystem.ts` with `createFmRouter` + `local` driver per project/worktree mount; swap `components/files/*` for `<FileDrawer />` + code previewer. Keep git-ignore as driver option. |
| bithk | Phase 1: write a `bithkDrive` driver adapter over the existing `drive_entries` / `file` service (no schema change), render with `fm/react`. Phase 2: move to `fm/managed` tables with a data migration. Share/team/project remain bithk features via hooks + actions. |
| zzci/drive | Unchanged; stays a reference. |

## 6. Delivery phases

1. **P0 foundation** — workspace + registry scaffold, `core`, `server`, drivers `memory` + `local` + `s3`, list/stat/read/write/mkdir/ops/archive, `client`, `react` list/tree/breadcrumb/preview (image, text, pdf)/single-PUT upload, `fm-api` + `fm-web`, `shadcn build` registry output.
   Verify: driver contract suite against memory + local + s3 (MinIO); `shadcn add` from the built registry into a scratch app compiles; e2e in `fm-web` (browse, upload, rename, move, delete).
2. **P1 object storage + Workers** — `r2` driver, chunked + multipart upload sessions, presign, thumbnail hook, local trash, `fm-worker`.
   Verify: contract suite against MinIO container and `wrangler dev` (miniflare R2); resume-after-abort upload test.
3. **P2 managed** — `fm/managed` (dedupe, versions, trash, favorites, search) on SQLite / D1.
   Verify: contract suite + managed-specific tests on both `bun:sqlite` and D1 (miniflare).
4. **P3 adoption** — bkd migration, bithk adapter then migration, picker / attachment compositions, SFTP / WebDAV drivers, watch.
