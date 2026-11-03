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

## 2026-11-03 10:30 [progress]

Search delivered (20261103-1005-recursive-search, 20261103-1005-quick-open): recursive search via `GET /m/:mount/search` with an optional `FmDriver.search` (bounded walk otherwise) and a "This folder" / "Everywhere below" scope toggle; quick open via `mode=fuzzy` ranked by `core/fuzzy.ts`, `localDriver({ gitIgnore })` listing candidates with `git ls-files`, and a Ctrl/Cmd+P dialog (toolbar button for touch) that previews a file or opens a folder. With `gitIgnore` on, git runs hardened (`-c core.fsmonitor=false -c core.untrackedCache=false --literal-pathspecs`, minimal environment) and writes to any `.git` path segment are FORBIDDEN, so a planted `.git/config` cannot run commands. Verified: `bun run check` (113 tests, 112 pass / 1 skip), 21 Playwright e2e.
