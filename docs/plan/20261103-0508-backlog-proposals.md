# 20261103-0508-backlog-proposals Open work after the Drive-parity batch

- **status**: draft
- **createdAt**: 2026-11-03 05:08
- **relatedTask**: see the task list entries created on 2026-11-03 05:08

## Context

State at `7dcf800` (2026-11-03): P0 foundation, Drive-parity batch (trash, undo, search, upload conflicts, details, new file, duplicate, preview navigation), view-only `features`, split / single / narrow layouts, image / video view tools, plugin API with `fm-plugin-sheet`, GitHub Actions CI. The project is handed over for maintenance; this document lists what is not done, with a design sketch per item so each can be claimed and planned on its own. Each item needs its own approved plan before implementation (PMA).

Priorities: P1 = next up, P2 = valuable, P3 = adoption / long term.

## Proposals

### 1. Cross-mount copy and move (P1) — task `20261103-0508-cross-mount-copy`

Today paste and drag only work inside one mount; `ops` takes a single `:mount`.

- API: `POST /m/:mount/ops` move / copy gain `destMount?: string`. Same mount → unchanged. Different mount → the router copies content: walk the source (reuse the archive walker with `archiveMaxEntries` / `archiveMaxBytes`), `mkdir` folders, stream each file `read → write` (no buffering beyond the driver), then for `move` delete the source (to trash when enabled). Authorize `read` + `copy|move` on the source and `write` on the destination mount.
- Partial failure: per-item results as today; a failed move leaves the source in place.
- Optional driver fast path later: `Driver.copyFrom?(other, from, to)` for same-backend copies (S3 → S3 CopyObject across buckets).
- UI: clipboard already stores `mount`; allow paste into another mount; allow dropping onto a mount / folder in the tree.
- Related small item: "Copy contents" context action for text files (clipboard API, size-capped), useful for config files.
- Verify: router tests memory → local and local → memory (files, folders, conflicts, auth on both sides); e2e paste across mounts.

### 2. Sidebar drive visibility and grouping (P1) — task `20261103-0508-sidebar-drives`

Hosts with many mounts (per project, per bucket) need to hide or group them.

- Host control: `<FileManager sidebar={{ hidden?: string[]; group?: "none" | "driver" }}>` — `hidden` removes mounts from the tree and the single-pane storage menu (still reachable via `initialMount`); `group: "driver"` renders a section per driver kind (Local, S3, Memory …) with collapsible headers.
- User control: "Manage drives" entry at the bottom of the tree (and in the storage menu) with a checkbox per mount; persisted in `localStorage` under `storageKey`. Host `hidden` wins over user choice.
- Server-side hiding stays the `mounts(c)` callback (per user / project); this item is presentation only.
- Verify: unit test for the visibility merge; e2e hide / show / group, persistence after reload, single-pane menu respects it.

### 3. Publish the registry (P1) — task `20261103-0508-publish-registry`

Hosts cannot `shadcn add @fm/...` until `public/r` is served.

- GitHub Pages workflow: on tag `v*` (and on main to a `next/` path) run `bun run registry:build` and deploy `public/r`.
- README: real registry URL in the `components.json` snippet; versioning note (tags pin the copied source).
- Verify: `registry:smoke` pointed at the deployed URL in CI after deploy.

### 4. Large and resumable uploads (P1) — task `20261103-0508-resumable-uploads`

`write` is a single PUT capped at 100 MiB; the S3 driver buffers the body.

- Upload sessions per `docs/architecture.md` §4: `POST /m/:mount/uploads` → `{ mode: "put" | "chunked" | "s3-multipart", partSize, urls? }`, `PUT …/parts/:n`, `POST …/complete`, `GET` to list received parts for resume, `DELETE` to abort.
- S3: multipart with presigned part URLs (browser uploads straight to the bucket); local: parts in a temp dir, concatenate on complete; memory: buffer.
- Client upload queue: switch to sessions above a threshold, retry parts, resume after reload (session id in `localStorage`).
- Verify: contract tests for sessions; resume-after-abort test; e2e with a multi-part file.

### 5. Cloudflare Workers + R2 (P1) — task `20261103-0508-workers-r2`

Workers compatibility is only lint-enforced.

- `r2` driver over the Workers binding (list with delimiter, multipart for big writes); `apps/demo-worker` with wrangler config; run the driver contract under `wrangler dev` / miniflare in CI.
- Verify: contract suite green on R2 (miniflare); demo-worker serves the same UI.

### 6. Thumbnails and saving image edits (P2) — task `20261103-0508-thumbnails`

- Server hook `thumbnail?: (c, target, width) => Promise<Response | undefined>` with a width whitelist; Bun implementation via an image library in a sibling registry item, Workers via Cloudflare Images. Grid view uses `read?thumb=256`.
- "Save rotation" in the image preview (canvas re-encode, same MIME for PNG / JPEG / WebP, `If-Match`), only with `write` + `features.edit`.
- Verify: router tests with a fake hook; e2e grid thumbnails and save-rotated round trip.

### 7. Trash retention and bulk actions (P2) — task `20261103-0508-trash-retention`

- `Mount.trash?: boolean | { retentionDays: number }`; purge expired items lazily on trash listing and via an exported `purgeExpired(mount)` for host cron.
- Trash view: multi-select, restore / delete selected, sort by deleted date.
- Verify: router tests with a fixed clock; e2e bulk restore.

### 8. Recursive search (P2) — task `20261103-0508-recursive-search`

- `GET /m/:mount/search?path&q&limit` — driver `search?` when available (managed store, S3 prefix scan), else a bounded walk (`archiveMaxEntries`), results with their parent path; respects `authorize` per hit.
- UI: scope toggle "this folder / everywhere below"; results list shows location and opens the containing folder.
- Verify: router tests incl. truncation flag and hidden trash; e2e.

### 9. Plugin follow-ups (P2) — task `20261103-0508-plugin-followups`

- Sheet plugin: virtualized rows (drop the 1 000-row cap), right-aligned numbers, optional CSV editing (write back with `If-Match`), XLSX dates as dates.
- New optional plugins: Markdown render (with "edit source" fallback), archive listing (zip entries without extracting), Office preview via a host-provided converter URL.
- Verify: unit tests per parser; e2e per plugin in the demo.

### 10. UI polish (P2) — task `20261103-0508-ui-polish`

- Marquee (rubber-band) selection; virtualized tree for large folders; drag files out to the desktop (`DownloadURL`); paste images / files from the OS clipboard to upload; keyboard shortcuts in the image preview (+ / − / 0 / R).
- Bundle: split the demo bundle (Vite warns at 500 kB; CodeMirror language data is the bulk) — lazy-load language data per file.
- CI: pin `runs-on` to `ubuntu-24.04` before the `ubuntu-latest` → 26 migration if it causes trouble.

### 11. bkd pilot adoption (P3) — task `20261103-0508-bkd-pilot`

- Per architecture §5: `local` driver with a `gitIgnore` option (via `git check-ignore`), a `<FileDrawer />` composition (single-pane, side drawer), editor drafts. First real host to validate the API.

### 12. Managed store and bithk (P3) — task `20261103-0508-managed-store`

- Phase 2 / 3 of architecture §6: `fm/managed` on SQLite / D1 (dedupe, versions, native trash, favorites, search), a bithk driver adapter, then migration; versions UI, share links via host actions; later SFTP / WebDAV drivers and `watch`.

## Out of scope for this document

Implementation detail beyond the sketches above; each item's plan refines its own design and verification.
