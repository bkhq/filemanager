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
