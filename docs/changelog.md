# Changelog

## 2026-11-02 11:57 [decision]

Project initialised from a survey of bithk (drive/file modules), bkd (files/filesystem routes), zzci/drive (Cloudreve) and open-source file managers; see `docs/architecture.md`. Decisions: shadcn-style registry distribution, generic managed store, demo app only, server code runs on Bun and Cloudflare Workers.

## 2026-11-02 12:10 [decision]

Plan 20261102-1157-p0-foundation approved. Storage backends are "drivers" behind one `Driver` interface (renamed from "provider" in architecture and plan); the `s3` driver moves into P0.

## 2026-11-02 18:30 [progress]

P0 foundation delivered (20261102-1157-p0-foundation): registry items fm-core, fm-server, fm-driver-contract, fm-driver-memory, fm-driver-local, fm-driver-s3, fm-client, fm-react; demo-api + demo-web. Verified: `bun run check` (79 tests incl. S3 contract against RustFS, 95% line coverage), 9 Playwright e2e flows, registry smoke install into a scratch app with non-default aliases.

## 2026-11-02 18:30 [pitfall]

shadcn does not rewrite `@/lib/utils` imports in custom-registry files; `fm/react` imports `cn` from the `cn` package instead. Tailwind in the demo needs `@source` for `registry/fm` because the sources live outside the app.

## 2026-11-02 19:10 [decision]

Plan 20261102-1908-drive-parity approved ("continue" after the Google Drive gap review). Trash is router-level and driver-agnostic (`Mount.trash`, hidden `/.fm-trash` folder) instead of a driver capability, so memory / local / S3 get it without interface changes.

## 2026-11-02 19:40 [progress]

Drive-parity batch delivered (20261102-1908-drive-parity): trash with restore / purge and undo snackbar (delete, move, rename, copy), name filter (`list?q=`), upload conflict dialog (replace / keep both / skip), details panel with folder size (`/usage`), new text file, duplicate, preview previous / next with discard guard, image click-to-zoom, `editable` prop. Verified: `bun run check` (75 tests), S3 contract against RustFS, 14 Playwright e2e flows, registry smoke.

## 2026-11-02 19:40 [pitfall]

The driver contract now requires `move` to create missing parent folders (trash relies on it). With trash enabled, a read-only mount over the same storage must also set `trash: true` so the `/.fm-trash` folder stays hidden.

## 2026-11-03 [progress]

`<FileManager>` gains `readOnly` (view-only preset) and `features` (per-action switches: upload, createFolder, createFile, edit, rename, move, copy, delete, download, search, details, trash), replacing the short-lived `editable` prop. Features mask entry caps client-side; server access control is unchanged. Demo has a "View only" toggle (`?view`).

## 2026-11-03 [progress]

Layouts: `layout="split" | "single"` initial value with a persisted sidebar toggle; containers under 640px are always single-pane (mount / trash switcher in the breadcrumb, details as overlay, compact list, toolbar wraps, tap opens, long press opens the context menu). Repository published to `github.com/bkhq/filemanager` (private).

## 2026-11-03 [pitfall]

Base UI menu radio items keep the menu open on click; navigation menus need `closeOnClick`.

## 2026-11-03 [progress]

Previews: images get zoom in / out / fit, rotate and flip; videos get rotate and flip (view only, files are not modified). Plugins: `FmPlugin { previewers, actions }` via `<FileManager plugins>`, actions receive an `ActionContext`. New optional registry item `fm-plugin-sheet` (CSV / TSV via papaparse, XLSX via read-excel-file; `xlsx` on npm is stale at 0.18.5 with known advisories). Repository made public.

## 2026-11-03 [pitfall]

Upload conflict detection must not trust a listing that is still loading or refetching; it now falls back to `stat` per name. read-excel-file requires the `r` cell reference on every `<c>` element.

## 2026-11-03 [progress]

GitHub Actions CI (`.github/workflows/ci.yml`) on push to main and PRs: `bun run check` with the S3 contract against a RustFS service container (pinned by digest), Playwright e2e, and the registry install smoke test. First run green (98 unit tests incl. S3, 19 e2e).

## 2026-11-03 05:08 [decision]

Backlog written for hand-over: `docs/plan/20261103-0508-backlog-proposals.md` (draft) with twelve pending tasks (cross-mount copy, sidebar drive visibility, registry publishing, resumable uploads, Workers + R2, thumbnails, trash retention, recursive search, plugin follow-ups, UI polish, bkd pilot, managed store). Each needs its own approved plan before work starts.

## 2026-11-03 15:30 [decision]

Gap review against bithk and bkd added to the backlog proposals (plan 20261103-0508). bkd pilot raised from P3 to P1 as the first adopter (gitignore, binary sniff, drafts, drawer). New tasks: 20261103-1530-change-events (P1), 20261103-1530-pick-mode (P1), 20261103-1530-quick-open (P1, blocked by recursive-search), 20261103-1530-list-filters (P2). Trash retention gains "Empty trash"; plugin follow-ups gain a PDF viewer and new-file templates / CSV import; UI polish gains pinch zoom.

## 2026-11-03 16:00 [decision]

Registry namespace renamed from `@fm` to `@bkhq` (hosts add `"registries": { "@bkhq": "<url>/r/{name}.json" }` and install `@bkhq/fm-react` etc.); item names keep the `fm-` prefix so they stay unique inside the `@bkhq` namespace. Workspace packages use the `@bkhq/` scope (`@bkhq/filemanager`, `@bkhq/demo-api`, `@bkhq/demo-web`). Registry `homepage` points to `github.com/bkhq/filemanager`. Runtime identifiers (`.fm-trash`, `application/x-fm-paths`, query / storage key `fm`, `FM_*` env vars) and the `src/fm/` install path are unchanged. Earlier entries and completed plans still say `@fm`.

## 2026-11-03 17:00 [decision]

Plan 20261103-0846-naming-conventions approved and delivered. Exported types under `registry/fm` carry the `Fm` prefix (React `*Props` exempt), enforced by `ts/naming-convention`; `createFileManager` / `FileManagerOptions` renamed to `createFmRouter` / `FmRouterOptions`. Full rule table in `docs/architecture.md` §3.0.2. Renames were applied with the TypeScript language service, so comments and strings were untouched; open docs use the new names, completed plans keep the old ones. Verified: `bun run check` (82 tests), 19 Playwright e2e, registry smoke.

## 2026-11-03 17:00 [decision]

Tracking: recursive-search raised to P1 (it blocks quick-open); publish-registry is blocked by naming-conventions; bkd-pilot is blocked by publish-registry, pick-mode, quick-open and change-events. Correction to the 2026-11-02 entry: `github.com/bkhq/filemanager` is public, not private.

## 2026-11-03 17:00 [pitfall]

Shells started by bkd put bkd's bundled bun 1.4.0 first on `PATH`; with it the local driver byte-range contract test fails and `bun install` strips `libc` fields from `bun.lock`. Use the version in `.bun-version` (1.4.4). Playwright browsers for 1.64.1 may be missing locally; `mcr.microsoft.com/playwright:v1.64.1-noble` with bun mounted runs `bun run test:e2e`.

## 2026-11-03 17:45 [decision]

Plan 20261103-0939-no-deprecated-apis delivered: no deprecated APIs remain (TypeScript 6385 / 6387 scan over all tsconfigs, tests and config files). `serveStatic` now comes from `@hono/bun` 1.0.1 (`hono/bun` is removed in Hono v5); the name dialog uses `SubmitEvent<HTMLFormElement>` instead of `FormEvent`, so hosts need `@types/react` >= 19.2.10. `ts/no-deprecated` runs with type information on registry, app sources and scripts (lint ~5 s -> ~11 s). Verified: `bun run check` (82 tests), 19 Playwright e2e, registry smoke.

## 2026-11-03 18:00 [decision]

Plan 20261103-0948-rename-dev-apps delivered: the workspace apps are `apps/fm-api` / `apps/fm-web` (`@bkhq/fm-api` / `@bkhq/fm-web`), the planned Workers app is `apps/fm-worker`, env vars are `FM_ROOT`, `FM_STATIC`, `FM_S3_*` (were `FM_DEMO_*`; rename keys in any local `.env`), the local data dir is `.tmp/fm-root`, and the page title is "File manager". Completed plans, old changelog entries and decision 001 keep the old names. Verified: `bun run check` (82 tests), 19 Playwright e2e, registry smoke, dev servers via nsl.

## 2026-11-03 18:05 [progress]

Campaign report: requirement plans written for the nine P1 tasks in this repository (change-events, recursive-search, quick-open, pick-mode, sidebar-drives, publish-registry, cross-mount-copy, resumable-uploads, workers-r2); campaign plan `20261103-1005-p1-campaign` partitions them into BKD L2 workstreams. Wave 1: A server-events, B search, C embedding-ui, D registry-publish (merge order D, A, B, C). Wave 2 after wave 1 merges: E transfer, F workers. Out of scope: bkd-pilot (other repo) and all P2 / P3 tasks. Found during investigation: `registry/fm/server/router.ts:152` JSDoc still says `createFileManager`; assigned to workstream A. All plans are drafts awaiting the dispatch confirmation.

## 2026-11-03 10:17 [progress]

Change event hook delivered (20261103-1005-change-events): `onEvent` / `FmChangeEvent` on the router, fired per item for write, mkdir, delete (incl. trash), rename, move, copy, restore, purge; awaited, hook errors logged and ignored; documented in architecture §3.3 and README; verified by `bun run check`.

## 2026-11-03 [progress]

Sidebar drives (20261103-1005-sidebar-drives): `<FileManager sidebar={{ hidden, group }}>` (`FmSidebarOptions`) hides mounts from the tree and the single-pane storage menu (still reachable via `initialMount`; the current mount is never hidden) and groups them by driver kind (`group: "driver"`). A "Manage drives" dialog lets users hide more, persisted at `${storageKey}:hidden`; host-hidden mounts are not listed. Logic in `react/mount-visibility.ts` (`visibleMounts`, `groupMountsByDriver`). Demo reads `?group=driver` and `?hidden=a,b`. Verified: `bun run check`, 22 Playwright e2e.

## 2026-11-03 [progress]

Pick mode (20261103-1005-pick-mode): `<FilePicker accept multiple maxTotalSize mounts onPick onCancel>` built on `FileManager` (view-only features, single layout, internal `pick` prop / `FmPickOptions`). Files outside `accept` (extensions and MIME globs, `acceptsEntry` in `react/accept.ts`) render disabled; folders stay navigable; a confirm bar shows count and total size and blocks Confirm over `maxTotalSize`. `mounts` filters the offered mounts through sidebar host-hidden. Demo reads `?pick`, `?accept=`, `?multiple`, `?max=`. Verified: `bun run check`, 26 Playwright e2e.

## 2026-11-03 [progress]

Registry publishing delivered (20261103-1005-publish-registry): `.github/workflows/registry.yml` deploys the registry to GitHub Pages (`main` -> `/next/r/`, each `v*` tag -> `/v{version}/r/`, highest tag -> `/r/`; every run rebuilds all tags from git) and smoke-tests the deployed URL; `scripts/registry-smoke.sh` accepts `REGISTRY_URL` to test a deployed registry; README uses `https://bkhq.github.io/filemanager/r/{name}.json` and the pinned `/v{version}/r/` form. Manual: enable Pages (source GitHub Actions) and allow tag `v*` on the `github-pages` environment. `oven-sh/setup-bun` is pinned by commit SHA in registry.yml (v2.2.0). Verified: `bun run check`, registry smoke, actionlint.

## 2026-11-03 10:30 [progress]

Search delivered (20261103-1005-recursive-search, 20261103-1005-quick-open): recursive search via `GET /m/:mount/search` with an optional `FmDriver.search` (bounded walk otherwise) and a "This folder" / "Everywhere below" scope toggle; quick open via `mode=fuzzy` ranked by `core/fuzzy.ts`, `localDriver({ gitIgnore })` listing candidates with `git ls-files`, and a Ctrl/Cmd+P dialog (toolbar button for touch) that previews a file or opens a folder. With `gitIgnore` on, git runs hardened (`-c core.fsmonitor=false -c core.untrackedCache=false --literal-pathspecs`, minimal environment) and writes to any `.git` path segment are FORBIDDEN, so a planted `.git/config` cannot run commands. Verified: `bun run check` (113 tests, 112 pass / 1 skip), 21 Playwright e2e.

## 2026-11-03 [progress]

Cross-mount copy and move delivered (20261103-1005-cross-mount-copy): `POST /m/:mount/ops` move / copy take `destMount`; another mount streams content between drivers file by file (source walk bounded by `archiveMaxEntries` / `archiveMaxBytes`, `copy|move` authorized on the source and `write` on the destination, a failed item removes its partial copy, `move` deletes the source, to the trash when enabled, only after the copy landed). Change events carry `toMount`. UI: paste into another mount, tree drop (same mount moves, another mount copies), "Copy contents" for text files up to 1 MiB (follows `features.download`). Cross-mount operations have no undo. Verified: `bun run check` (142 tests, 141 pass / 1 skip).

## 2026-11-03 11:00 [progress]

`POST /m/:mount/ops` rejects rename / move / copy items whose final target is a hidden path (e.g. `/.fm-trash`) with `INVALID` "Reserved name", before any write.

## 2026-11-03 11:55 [progress]

Resumable uploads delivered (20261103-1005-resumable-uploads): upload session routes under `/m/:mount/uploads` (create, status, part, complete, abort) with records in a hidden `/.fm-uploads` folder, `write` re-authorized on every call and one `write` change event on complete; optional `FmDriver.multipart` in the memory, local and S3 drivers (S3 presigned part URLs opt-in via `presignUploads`), and a streaming S3 PUT when the size is known. The client queue sends files of 16 MiB and more through sessions with per-part retry and resume via `localStorage`; `fm-api` reads `FM_UPLOAD_PART_SIZE`. Verified: `bun run check` (194 tests, 193 pass / 1 skip), the same against RustFS (234 pass), 32 Playwright e2e including an 18 MiB multi-part upload.

## 2026-11-03 [progress]

Cloudflare Workers delivered (20261103-1005-workers-r2): `r2Driver({ bucket, prefix?, readOnly?, maxObjects? })` over the R2 binding (registry item `fm-driver-r2`, structural `FmR2Bucket` type, native multipart with part records in a hidden `.fm-r2-parts` folder, no presign) and `apps/fm-worker` (wrangler, `/api/fm` with an R2 mount plus the `fm-web` assets; no auth, add Access / bearer token / `authorize` before deploying). The driver contract runs under `bun test` against miniflare 4.20260730.0; wrangler 4.157.0, `@cloudflare/workers-types` 5.20261103.1, compatibility date 2026-11-03. CI job `workers` runs the contract and `wrangler deploy --dry-run`.

## 2026-11-03 13:50 [progress]

P1 campaign `l1-d4j0p0gu-20261103101038` complete (plan 20261103-1005-p1-campaign): change events, recursive search + quick open (with git ls-files hardening), FilePicker + sidebar drives, registry publishing workflow, cross-mount copy / move (with a reserved-target guard), resumable uploads (sessions, multipart for memory / local / S3, opt-in presign), R2 driver + `apps/fm-worker`. Merged into local `main` only, not pushed. Final `bun run check`: 219 pass / 1 skip; 32 e2e; registry smoke OK. Deferred items are listed in the campaign plan Decisions.

## 2026-11-04 02:10 [progress]

Resizable panels (20261104-0200-resizable-panels): the folder tree and details panel in `<FileManager>` are shadcn `resizable` panels (react-resizable-panels 4.17.0) instead of fixed `w-56` / `w-72`; drag or arrow keys resize them, sizes persist under `${storageKey}:panels`. `fm-react` now requires the shadcn `resizable` component and `react-resizable-panels`. Verified: `bun run check`, 33 Playwright e2e, registry smoke.

## 2026-11-04 02:12 [progress]

Folder tree rebuilt on shadcn `collapsible` + `button` (20261104-0212-tree-collapsible): each row is one focusable trigger button (chevron, icon and label, as in the shadcn file-tree demo), subfolders load across all listing pages. `fm-react` now also requires the shadcn `collapsible` component.

## 2026-11-04 02:24 [progress]

Folder tree: files are listed under their folders (click reveals the file in the list), a row click navigates and toggles, and the tree supports WAI-ARIA keyboard navigation (Up / Down / Home / End, Right to expand or enter, Left to collapse or go to the parent, Enter / Space to activate). Verified: 34 Playwright e2e.

## 2026-11-04 02:27 [progress]

Folder tree context menus: right-clicking a folder or file row reveals it in the list and opens the same entry menu as the list; a mount row opens the folder menu (new folder, new file, upload, paste, refresh) at the mount root; trash and group rows open none. Verified: 35 Playwright e2e.

## 2026-11-04 02:30 [progress]

Context menus: the list and the tree share one menu shell (`w-56`); every item has an icon ("Open" uses a folder-open or preview icon); shortcuts the list handles are shown on the right (Enter, Ctrl/⌘+C / X / V, F2, Del; hidden from the accessible name); groups follow VS Code: open / download, cut / copy / duplicate / copy contents, rename / details, plugin actions, delete. Verified: 35 Playwright e2e.

## 2026-11-04 03:50 [progress]

Tree + preview layout (20261104-0337-tree-preview-layout): with the folder tree shown, the right side previews the selected file inline (or shows the folder's empty state) instead of the file list; the list remains in the single / narrow layouts and the picker. Tree toolbar for folder actions, tree rows draggable across folders and mounts, unsaved inline edits guarded. \`PreviewBody\` / \`DiscardChangesDialog\` live in the new \`react/preview-pane.tsx\`. Verified: 37 Playwright e2e.

## 2026-11-04 05:44 [progress]

Tree + preview header: an editor-style path bar (`react/path-bar.tsx`, modelled on the bks file browser) replaces the up button and breadcrumb in the split layout: mount › folders › open file; each step opens a picker of its siblings (folders unfold, files open, "Open <folder>" on folder steps), the mount step switches mounts. Verified: tree e2e + new path bar e2e.

## 2026-11-04 05:50 [progress]

Split layout keeps the open file: clicking folders or mounts only moves the tree's focus; the preview changes only when another file is selected (`openFile` state, cleared when the file disappears from its loaded folder or is deleted from the header). The path bar shows the open file's path; every step, including the mount, lists its siblings (no folder-open item). Download, rename and delete act on the entry's own mount; renaming the open file keeps it open. Verified: 38 Playwright e2e.

## 2026-11-04 05:58 [progress]

Explorer parity requirements written from the bks / bkd comparison: campaign plan `20261104-0558-explorer-parity` with four workstream tasks and plans — editor (A1 Ctrl+S / unsaved marker, A2 wrap, B2 large files read-only, B3 conflict choices, B4 persisted drafts), browser-shell (A3 copy path / name, A4 folder-targeted new / upload, A5 collapse all, B7 remembered location, B8 phone tree / preview switch), listing (A6 hidden files toggle, B6 git-ignored entries), previews (A7 PDF toolbar off, B1 binary sniff, B5 Markdown plugin). Group C stays in existing tasks. Drafts awaiting the dispatch confirmation.

## 2026-11-04 06:40 [progress]

Browser shell (20261104-0558-browser-shell) delivered: entry menus copy the path / name (A3); tree folder / mount rows and list folder rows offer "New file here", "New folder here", "Upload here" without navigating (A4); tree expansion is owned by `FileManager` with "Collapse all" in the tree toolbar (A5); the last mount, folder and open file are restored from `${storageKey}:last`, stale parts ignored, the file reopened only in the tree layout (B7); in the split layout a container narrower than 640px shows the tree or the open file one at a time, with a guarded "Back to folders" button (B8; `single` and the picker keep the narrow list, the layout toggle stays hidden on narrow). Verified: `bun run check` (219 pass / 1 skip), 45 Playwright e2e passed.
