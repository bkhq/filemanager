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

## 2026-11-04 06:30 [progress]

Listing (20261104-0558-listing): list and search take `hidden=0|1` / `ignored=0|1` (default 1); entries carry an optional `ignored` flag and listings an `ignored` count. The local driver with `gitIgnore` marks ignored entries with one `git check-ignore -z --stdin` per listing, sharing the hardened git spawn with search (fsmonitor and untracked cache off, minimal env); failures mark nothing. The tree toolbar adds "Show hidden files" (default off) and "Show git-ignored files" (default on, shown when a listing has ignored entries) toggles, persisted per `storageKey` and applied to the tree, list, path bar, search and quick open; ignored rows are dimmed. Verified: 229 unit tests (10 new), 39 Playwright e2e (1 new).

## 2026-11-04 06:31 [progress]

Previews (20261104-0558-previews): the PDF iframe hides the browser viewer's toolbar and sidebar (`#toolbar=0&navpanes=0`); files of unknown type up to 2 MiB, including extensionless ones such as `hosts` or `LICENSE`, are sniffed with a Range read of their first 8 KiB (`looksBinary` in `react/state.ts`, built-in `sniff` previewer) and open in the text editor unless a NUL byte marks them binary. New optional registry item `fm-plugin-markdown` (`react-markdown`, `remark-gfm`, lazily loaded `shiki`) renders `.md` / `.markdown` with GFM tables, task lists and highlighted code, no raw HTML, and a Rendered / Source toggle in the preview header (Source is the text editor); fm-web enables it and the fm-api seed gains a `samples/` folder. Verified: `bun run check`, 40 Playwright e2e.

## 2026-11-04 06:33 [progress]

Editor workstream (20261104-0558-editor) delivered: Ctrl/Cmd+S save with an "Unsaved" marker and "Discard changes" (A1), persisted word wrap `fm:wrap` (A2), text files over 2 MiB open read-only from a Range read through `client.readText` with a range option, with a banner (B2), conflict banner with Overwrite / Reload from disk / Keep editing (B3), drafts persisted per mount + path in `fm:drafts` via the new `react/drafts.ts` (`loadDraft` / `saveDraft` / `clearDraft` / `clearDrafts`, 50 entries / ~5 MiB) and restored on reopen (B4); the unsaved-changes guard's "Discard" now drops the stored draft. Verified: `bun run check`, 45 Playwright e2e.
Follow-up: `client.read` returns the raw response (range / version) for the sniff and sheet previews; delete, rename and move drop the drafts of the source paths.

## 2026-11-04 06:40 [progress]

Browser shell (20261104-0558-browser-shell) delivered: entry menus copy the path / name (A3); tree folder / mount rows and list folder rows offer "New file here", "New folder here", "Upload here" without navigating (A4); tree expansion is owned by `FileManager` with "Collapse all" in the tree toolbar (A5); the last mount, folder and open file are restored from `${storageKey}:last`, stale parts ignored, the file reopened only in the tree layout (B7); in the split layout a container narrower than 640px shows the tree or the open file one at a time, with a guarded "Back to folders" button (B8; `single` and the picker keep the narrow list, the layout toggle stays hidden on narrow). Verified: `bun run check` (219 pass / 1 skip), 45 Playwright e2e passed.

## 2026-11-04 08:20 [progress]

Explorer parity campaign `l1-d4j0p0gu-20261104060841` complete (plan 20261104-0558-explorer-parity): A1-A7 and B1-B8 from the bks / bkd comparison merged into local `main` (listing `4e612f2`, previews `00a9d20`, editor `4d3ffee`, browser-shell `34d551d`, editor follow-up `fe61759`). Final on `main`: `bun run check` 243 pass / 1 skip, registry smoke OK, 57 Playwright e2e. Not pushed.

## 2026-11-04 08:39 [progress]

Editor-style header: Markdown files open in the text editor by default with an "Open preview" / "Reopen as source" button (VS Code style); the split-layout header drops download / rename / delete (they are in the context menu); Save and More (discard changes) appear only while there are unsaved edits. Verified: `bun run check`, 57 Playwright e2e.

## 2026-11-04 09:40 [progress]

Dropzone / streamdown / catalog delivered (20261104-0843-dropzone-streamdown): uploads through react-dropzone (section drop, empty-preview click area), Markdown live preview beside or instead of the editor rendered with streamdown, `@nsio/nsl` removed in favour of the global CLI, Bun `catalog` for `shadcn`.

## 2026-11-04 09:40 [pitfall]

react-dropzone `getRootProps`: with `noKeyboard` it discards the passed `onKeyDown`, with `disabled` it adds `aria-disabled` (assistive tech and Playwright then treat every control inside as disabled) and it defaults `role` to `presentation`. Pass key handlers outside `getRootProps` and override those props. streamdown needs `@source` lines in the host CSS.

## 2026-11-04 10:05 [progress]

Explorer tree header follows VS Code: an "Explorer" title, New file / New folder / Refresh / Collapse all shown on hover or focus, and a "More" menu with upload, paste, quick open and the hidden / git-ignored toggles (checkbox items).

## 2026-11-04 10:30 [progress]

Demo header: title on the left; on the right a view-only shadcn Checkbox, a language dropdown (English / 中文, saved as `fm-demo:lang`) and a theme dropdown (light / dark / system); radio items use `closeOnClick` (Base UI keeps menus open by default). The text editor now follows `.dark` on `<html>` live (MutationObserver via `useSyncExternalStore`) instead of reading it once per render.

## 2026-11-04 10:50 [progress]

Explorer refresh also reveals the selected row (or the current folder): its ancestors expand and the row scrolls into view once rendered, as in VS Code.

## 2026-11-04 11:50 [progress]

Trash retention and multi-select delivered (20261104-1110-trash-retention): `trash: { retentionDays }` with lazy purge on listing and exported `purgeExpired`, trash view selection with bulk restore / delete forever, sorting and expiry column.

## 2026-11-04 12:40 [progress]

UI polish delivered (20261104-1110-ui-polish): marquee selection, virtualized tree, drag out to desktop (`DownloadURL`), paste upload, image keys, bundle measured (warning limit raised with numbers), CI `setup-bun` pinned and runners on `ubuntu-24.04`.

## 2026-11-04 12:40 [pitfall]

A Ctrl+V keydown handler that calls `preventDefault` suppresses the browser `paste` event, so OS clipboard files never arrive; only claim the key when there is something to paste internally. Virtualized trees cannot use DOM order for keyboard nav (off-screen rows are absent); navigate by row index and scroll before focusing.

## 2026-11-05 01:55 [progress]

When the mounts request fails (API down), `<FileManager />` shows "Cannot reach the file server" with the error and a Retry button instead of loading forever.

## 2026-11-05 03:30 [progress]

List filters and host metadata delivered (20261105-0210-list-filters): type / modified filters for the list and tree (chips, per-mount persistence), optional `meta` prop for starred / recent (tree sections, star action, recent on open); demo implements it on localStorage.

## 2026-11-05 03:30 [pitfall]

With a virtualized tree, e2e assertions on rows far from the scroll position fail (rows are not in the DOM); collapse or scroll first. Folders loading several pages keep growing after the first rows appear, so wait for the full height before keyboard End.

## 2026-11-05 03:50 [progress]

Starred / recent are configurable: `features.starred` / `features.recent` (host, default on, kept in view-only) drop the section and its actions; "Show starred" / "Show recent" in the explorer's More menu hide the sections per user (`<storageKey>:show-starred|recent`).

## 2026-11-05 04:20 [progress]

Starred / Recent render as trees: section → drive → folders (single-child chains compacted to `a/b`) → entries; starred folders expand into their contents like drive rows. Rows inside host lists are never "active" and their accessible name carries the location. e2e keeps the demo meta off by default (`fm-demo:meta-off`) and turns it on per test, so host-list rows do not duplicate drive rows elsewhere.

## 2026-11-05 06:30 [progress]

Thumbnails and image saving delivered (20261105-0440-thumbnails): router `thumbnail` hook and `/thumb` route, `fm-thumbnail-bun` (Bun.Image) and `fm-thumbnail-cloudflare` (Images binding) registry items, grid thumbnails, Save rotation / flip from the image preview.

## 2026-11-05 06:30 [pitfall]

Bun 1.4 has a built-in `Bun.Image` (decode, resize, WebP / AVIF / PNG / JPEG encode), so image work on Bun needs no native dependency. `wrangler dev` emulates the Images binding locally (sharp in miniflare). The preview dialog held the entry captured on open; anything that rewrites the file must read the listing's copy to see the new etag.

## 2026-11-05 08:40 [progress]

Sheet plugin upgrade and zip browsing delivered (20261105-0700-sheet-archive): virtualized typed sheet with CSV / TSV editing and `If-Match` saves; `/zip/entries` + `/zip/read` (central directory via ranged reads, Zip64, streamed deflate) and the new `fm-plugin-archive`.

## 2026-11-05 08:40 [pitfall]

`kindOf` classifies images by MIME type only; zip entries carry none, so the archive view checks extensions itself. The eslint autofix rewrites `Array.from({ length }, () => "")` to `Array.from({ length }).fill("")`, which types as `unknown[]`; pass the element type (`Array.from<string>`).

## 2026-11-05 09:10 [progress]

The explorer tree scrolls inside shadcn `ScrollArea` (Base UI) instead of a native overflow container; the virtualizer and reveal use its viewport (`[data-slot=scroll-area-viewport]`). fm-react gains the `scroll-area` registry dependency.

## 2026-11-05 09:30 [progress]

Text entries in the archive view render with a read-only, highlighted CodeMirror (`CodeView` in `text-preview.tsx`, language from the entry name, follows the theme), loaded lazily with the first text entry.

## 2026-11-05 09:50 [progress]

Right-side scrolling uses shadcn `ScrollArea` too: text editor and archive `CodeView` (CodeMirror grows with its text; long lines without wrap still scroll inside the editor), file list / grid (virtualizer and marquee on the viewport via `viewportRef` in `react/scroll.ts`), Markdown preview, trash table, details panel, archive entry tree. The sheet grid (both axes, sticky header and row numbers) and the zoomed image stage keep native scrolling.

## 2026-11-05 10:05 [decision]

The demo's `ScrollArea` scrollbar auto-hides: transparent by default, fades in while the pointer is over the area (`data-hovering`) or while scrolling (`data-scrolling`), 150 ms opacity transition. Changed in `apps/fm-web/src/components/ui/scroll-area.tsx` only; hosts keep whatever their own shadcn `scroll-area` does.

## 2026-11-05 10:40 [decision]

Plan 20261105-1030-file-drawer rejected: no `<FileDrawer />` in the library. Hosts (bkd, bks) wrap `<FileManager />` in their own drawer / side panel and decide its chrome; `FileManager` already adapts to narrow widths and accepts `className`. Architecture updated accordingly; the bkd pilot task keeps only the adoption in the bkd repo.

## 2026-11-05 11:00 [progress]

Popups and panel lists scroll in `ScrollArea` as well: path bar pickers, Storage menu Starred / Recent submenus, quick open results and the upload panel use `MenuScroll` (`react/menu-scroll.tsx`: viewport capped at `max-h-80` / `max-h-60`, popup drops its own overflow and padding).

## 2026-11-05 11:40 [decision]

Image preview tools are view-only: rotate, flip and zoom never write the file. The Save rotation / flip button (added in 20261105-0440-thumbnails) is removed with its canvas re-encode, labels and e2e; the rotate test now asserts no Save is offered. The preview dialog keeps following the listing's copy of its entry.

## 2026-11-05 15:00 [progress]

Change messages delivered (20261105-1300-change-message): `X-Fm-Message` from client to driver (`FmChangeContext`) and `onEvent`, `changeMessage` prop with a prompt mode and a host-owned mode, demo toggle.

## 2026-11-05 16:30 [progress]

Review and bkd prerequisites delivered (20261105-1400-review-changes): driver changes capability with a git implementation, status decorations and a Changes tree section, `fm-plugin-review` (CodeMirror merge diffs, review all), editor reload / conflict on external edits, sandboxed SVG preview.

## 2026-11-05 16:30 [pitfall]

e2e against a shared, growing root: virtualized lists and trees only render rows near the viewport, so tests must filter or reveal before clicking rows that sort late. A git repository created in the e2e root must be removed in `finally`, otherwise every later test file shows up as a change.

## 2026-11-05 16:50 [pitfall]

Security review: with `gitChanges` but without `gitIgnore`, users could write `.git/config` through the mount and make the server's `git diff` run commands (`diff.external`, textconv, clean filters). `gitChanges` now also makes `.git` paths read-only, and git runs with `--no-ext-diff --no-textconv`, `diff.external=` and `core.hooksPath=/dev/null`; a test plants such config and asserts nothing runs. Config the host itself puts in the repository stays trusted; `GIT_CEILING_DIRECTORIES` is not set because roots below the repository top must still find it.

## 2026-11-05 17:20 [decision]

`fm-plugin-review` renders diffs with `@pierre/diffs` (as bkd does) instead of `@codemirror/merge`: `MultiFileDiff` from the base and current texts, split / unified, bars, collapsed unchanged runs, github light / dark themes; review-all scrolls in its `Virtualizer`, so only visible lines render. Highlighting runs on the main thread (no worker pool), keeping the plugin free of bundler-specific worker imports.

## 2026-11-05 17:50 [pitfall]

Security review: the baseline of a renamed file is read from its previous path, which the caller might not be allowed to read (rename out of a restricted folder). `readBase` now reports `from`; `/changes/base` authorizes it (and the hidden-folder rule) before streaming, and `/changes` turns such a rename into "added" without `previousPath`.

## 2026-11-05 19:30 [progress]

Adoption fixes from the bks review (20261105-1830-adoption-fixes): `implicitFolders` and `uploads: false` mount options, `runDriverContract` options for flat / seeded storages, `data-tree-path` / `data-tree-mount` on tree rows.

## 2026-11-06 02:30 [pitfall]

Folder tree empty after `FileManager` mounts again over cached listings (reported from bks: switching tabs away and back). `FileTree` read its scroll element from a ref that `viewportRef` fills on the `ScrollArea` root, an ancestor; React attaches an ancestor's ref after its children's layout effects, so the virtualizer saw no scroll element on the first commit and only recovered when a later render followed (the listing arriving on a cold mount). The tree viewport is now state in `FileManager` and passed as `scrollElement`, so attaching it re-renders the tree. `FileList` and the archive view own their `ScrollArea`, so their refs are attached in time. Regression: `react/file-manager.test.ts` (happy-dom, first DOM unit test; `bunfig.toml` keeps `.tsx` components out of the unit coverage report) and an e2e that toggles the demo's new "Mounted" switch. Verified: `bun run check`, 84 Playwright e2e (run in the `mcr.microsoft.com/playwright:v1.64.1-noble` container; station lacks Chromium's system libraries).

## 2026-11-06 03:20 [progress]

Explorer header actions (new file / folder, refresh, collapse all) are no longer hidden on touch screens, which cannot hover. With a mouse they appear on hover at any tree width. e2e covers the default and a narrowed tree.

## 2026-11-06 06:00 [progress]

`sidebar.drives: false` leaves the drives and "Manage drives" out of the folder tree, so only its sections remain; with `features.starred` / `features.recent` off the tree shows the Changes section only. The demo turns this on with `?review`. e2e covers it in the review test.

## 2026-11-06 06:30 [progress]

The Changes section header shows the line counts of every change added up (`+N −M`, `FmTreeSection.extra`). The local driver now counts the lines of untracked text files up to 1 MiB (`additions`, `deletions: 0`), since `git diff --numstat` leaves them out; binaries and larger files stay uncounted. Unit test for untracked counts; the review e2e checks the totals.

## 2026-11-06 07:30 [progress]

Context menus no longer show separators that hidden items leave at either end or side by side (a read-only file used to end its menu with one, since Delete is hidden). `menuContent` passes every list, tree and blank-area menu through `tidyMenu` (`react/tidy-menu.ts`), which also flattens nested groups. Unit tests for `tidyMenu`; a render test checks the read-only file menu.

## 2026-11-06 07:45 [progress]

Manage drives is left out (tree button and storage menu) when the host shows only one drive, since there is nothing to pick. Drives the user hid still count, so the dialog stays reachable to show them again. `FileTree.onManage` is optional; a render test checks one drive against two.

## 2026-11-06 08:00 [progress]

Drive variant (20261106-0700-drive-variant, phases 1 and 2). Phase 1: `react/file-manager.tsx` (2302 lines) split without behaviour change into state hooks (`use-view-state`, `use-listing-state`, `use-changes`, `use-commands`, composed by `use-file-manager`), `manager-menus`, `manager-overlays`, `manager-list`, `manager-shared`, and the workspace shell (`workspace-shell`, `workspace-tree-pane`); every file is under 800 lines and the 85 e2e tests passed unchanged. Entries gain optional `id` and `extra`, passed through list / stat / search (router test). Phase 2: `<FileManager variant="drive">` (`drive-shell`, `drive-nav`, `drive-ref-list`): spaces navigation with Recent / Starred / Trash (an overlay on narrow containers), New and Upload menus, search, grid by default (preference stored apart), filter and sort bar, batch bar for the selection (download, copy, cut, rename, host actions, delete), preview dialog; no tree, review, quick open or hidden / ignored toggles. The preview dialog steps through siblings only when the file is in the current folder. Demo: `?variant=drive`. Verified: `bun run check` (302 pass), 93 Playwright e2e (8 new in `tests/e2e/drive.spec.ts`), `registry:smoke`.

## 2026-11-06 08:30 [decision]

The drive view leaves `fm-react`: hosts that only browse and edit files should not carry it. `FileManager` loses `variant` and every drive import; `<DriveManager>` (`react/drive-manager.tsx`) is the new optional `fm-drive` registry item with `drive-shell`, `drive-nav`, `drive-ref-list`, and depends on `fm-react`. Both share `useFileManager(props, mode)` and the new `ManagerFrame` (unreachable / empty states, container, overlays). Host extensions (plan 20261106-0741, rejected) and the managed store (plan 20261105-1120) wait for a drive redesign; the managed store will be its own `fm-managed` item.

## 2026-11-06 09:00 [progress]

Drive layout for bithk (20261106-0830-drive-tree-layout): `<DriveManager>` now shows the workspace's folder tree on the left (spaces, Starred, Recent, Trash; folders only, the listed folder expanded and highlighted), the chosen folder on the right (grid by default, list toggle, filter / sort bar, batch bar), and files in the preview dialog, including Starred / Recent files. No Changes section or change badges. In `fm-react`, drive mode keeps the tree but never acts as the explorer, and the tree part of the workspace pane is shared as `manager-tree.tsx`. The spaces navigation and its Recent / Starred lists (`drive-nav.tsx`, `drive-ref-list.tsx`, 5 labels) are removed. Verified: `bun run check` (307 pass), 95 Playwright e2e (10 in `drive.spec.ts`), `registry:smoke`.

## 2026-11-06 09:20 [progress]

Drive tree: a listed folder without subfolders is a leaf (no chevron, no `aria-expanded`), so folders that only hold files no longer open to nothing. `FileTree` gains `foldersOnly` (drive rows list folders only; the filter moved out of `treeFilter`); folders not listed yet keep their chevron until first opened. The drive e2e checks it. The 2026-11-06 fixes on `main` (menu separators via `tidyMenu`, Manage drives hidden with one drive) were already carried into the split files; no merge was needed.

## 2026-11-06 09:40 [progress]

Subfolder hints (20261106-0913-subfolder-hint): folder entries may carry `hasSubfolders`, passed through list / stat / search. The memory driver always sets it; the local driver reads each child folder with `opendir` (32 at a time, stopping at the first folder, unknown past 256 entries or at a symlink); S3 / R2 leave it unset. Listing 1 000 folders locally went from about 24 ms to about 38 ms. The drive tree (`FileTree.foldersOnly`) shows folders with `hasSubfolders: false` as leaves before they are opened; a loaded listing still wins over the hint. Contract suite checks hints when given; router, memory, local tests and a drive e2e added.

## 2026-11-06 10:10 [progress]

Drive extension points for bithk (20261106-0913-bithk-extension-points). Server: `FmMount.group` and `FmMount.quota` (`{ used, total? }`) reach `FmMountInfo`. Drive tree groups spaces by `group` (`FileTree` `group: "space"`, ungrouped spaces at the top level) and shows the current space's quota (bar and text) under the tree. `fm-react`: `columns` (`FmColumn` over `entry.extra`: list cells, details rows, column-value filters stored in `FmListFilters.extra`) and `detailTabs` (`FmDetailTab`: host tabs in the details panel) on both managers. `fm-drive`: "Move to… / Copy to…" actions with `DriveFolderPicker` (writable spaces, folders only, blocks moving into itself or back into its folder; cross-space via `destMount`). Demo: "Personal" group and quota on Local disk, a read-only "Team plans" space in "Shared with me" with `extra.owner` (hidden outside the drive demo), an Owner column with a filter and an Activity tab. Verified: `bun run check` (318 pass), 101 Playwright e2e (16 drive; workspace spec unchanged), `registry:smoke`.

## 2026-11-06 10:30 [progress]

Driver-provided trash (20261106-0943-native-trash): optional `FmDriver.trash` (`remove` / `list` / `get` / `restore` / `purge`, items with epoch `deletedAt` and optional `expiresAt`). The router reaches every trash path through `trashOf(mount)` (the driver's trash, else `folderTrash(driver)` wrapping the `/.fm-trash` layout unchanged): ops delete, the source of a cross-mount move, `GET /trash`, restore (the router still picks a free path under the original folder), purge, retention and `purgeExpired`. An item's own `expiresAt` wins over `retentionDays`; `/.fm-trash` is hidden only for folder trash. `purgeExpiredItems` / `expiresAt` in `server/trash.ts` were folded into the router. Routes, client, undo and `TrashView` are unchanged. `memoryDriver({ nativeTrash: true })` is the reference (the demo's Scratch space uses it); the contract suite runs trash cases when the hook exists.

## 2026-11-06 09:59 [progress]

Drive demo: a "Team drive" space in the "Team" group shows a database-style backend (task 20261106-0959-demo-native-trash): a memory driver wrapped with stable entry ids that follow renames and moves, owners kept by id, and its own trash (`FmDriver.trash`) whose items expire after 14 days with no mount `retentionDays`. The Activity tab shows the entry id. Fix: `TrashView` now shows the Expires column whenever an item has `expiresAt` (a driver's own expiry), not only with the mount retention. e2e: delete into the space's trash, see "In 14 days", restore; the id stays across a rename.

## 2026-11-08 01:20 [progress]

Image preview zoom (20261107-0950-image-pan-zoom), keeping `react-zoom-pan-pinch` 4.2.0: the zoom viewport is the whole preview stage and its content the fitted (rotated) image box, so any aspect ratio uses the full area when zoomed (a 1000x3000 image no longer stays in a 228 px column). The ceiling is `maxZoomOf(fit)` = max(4x fit, 4x real size), so large images reach their pixels (a 6000x4000 image stopped at 43% before). Zoom in / out (buttons, `+` / `-`) multiply by 1.5 around the middle of the view (`zoomAround`) instead of the library's additive step, which barely moved large images. The percentage toggles fit and real size ("Actual size"); the cursor is `zoom-in` at fit and `grab` / `grabbing` when zoomed; while zoomed, arrow keys pan (library keyboard), at fit they still step through files. Removed the unused `FmMediaView.zoom`, `clampZoom` and `ZOOM_STEP`; `apps/fm-web` pins `react-zoom-pan-pinch` to 4.2.0. Tests: `transform.test.ts` (layout, ceiling, zoom around a point), `tests/e2e/image.spec.ts` (generated 6000x4000 and 1000x3000 PNGs: real size, beyond it, drag, stage-wide view); the zoom-step expectations in `fm.spec.ts` changed from 125% to 150%. Verified: `bun run check` (351 pass), 105 Playwright e2e, `registry:smoke`.

## 2026-11-08 03:50 [progress]

Image preview toolbar keeps one rotate button (clockwise, task 20261108-0342-one-rotate-button); Shift+R still rotates the other way. The `rotateLeft` label stays in `FmLabels` so hosts with full label objects keep compiling. e2e: no "Rotate left" button, four quarter turns come back to 0°.

## 2026-11-08 06:10 [progress]

Image preview extras (20261108-0546-image-viewer-extras): a minimap (`react-zoom-pan-pinch`'s `MiniMap`, 160 px on the longer side, bottom-right) while zoomed, showing the view on the whole image; click or drag in it to move. A checkerboard (theme `--muted` on `--background`) behind the image box, so transparent pixels of PNG / WebP / SVG read as transparent. The toolbar shows the pixel size ("6000 × 4000"), also in the percentage button's title. Pixel size and minimap are left out below a 480 px stage. No new dependency, prop or export. e2e: minimap appears when zoomed, moves the view, goes at fit; pixel size; checkerboard behind a half-transparent PNG. Verified: `bun run check` (351 pass), 108 Playwright e2e, `registry:smoke`.

## 2026-11-09 [pitfall]

Image minimap could drag the view off the image: `MiniMap`'s own panning (on by default) assumes content as large as the viewport. It is off now (`panning={false}`); `media-stage.tsx` moves the view itself with `centerOn`, and zoom buttons use `clampPan`, so the image stays over the view.

## 2026-11-09 01:30 [progress]

Copy path (20261109-0117-copy-absolute-path): "Copy path" copied the mount-relative path, which only looked absolute. `FmMount.absoluteRoot` (host-set, returned by `GET /mounts`, never derived from the driver) now gives the real path; without it the item is hidden. New "Copy relative path" drops the leading slash. The details panel copies the absolute path when known, else the relative one. Hosts must set `absoluteRoot` to keep "Copy path".

Copy path follow-up, as in VS Code: "Copy path" and "Copy relative path" form their own menu group with shortcuts (Option+Cmd+C and Shift+Option+Cmd+C; Ctrl+Alt+C and Ctrl+Shift+Alt+C elsewhere).

## 2026-11-09 01:50 [progress]

The file preview and review dialogs have a full-screen toggle (20261109-0125-dialog-fullscreen, shared `dialog-maximize.tsx`): the dialog fills the browser window, without the Fullscreen API so toasts and nested dialogs keep working. An image refits and stays centred. e2e covers the preview dialog; the review dialog shares the button and classes.

Image zoom smoothness: zooming no longer re-renders `MediaStage` on every frame (the percentage is written directly; only crossing fit renders), every zoom uses one 280 ms `easeOutCubic` curve, and the minimap image decodes asynchronously.

The full-screen toggle is instant (`transition-none`): the dialog animated height and position while `max-width` jumped, which jittered.

## 2026-11-09 02:30 [progress]

Audit clean-up (20261109-0211-audit-cleanup): no compatibility layer existed. Removed `registerPreviewer` (previewers come from `FmPlugin.previewers`) and the unused labels `folderName`, `newName` and `rotateLeft`; `server/trash.ts` only exports `TRASH_DIR` and `folderTrash`. The demo's `fm-demo:*` localStorage keys are now `fm-web:*`. `docs/architecture.md` and ADR 001 match the code, and task statuses are synced (bkd pilot completed by bkd PR #162).

## 2026-11-09 03:40 [progress]

`DriveShell` and `WorkspaceShell` share their common UI through `react/shell-parts.tsx` in `fm-react` (20261109-0221-shared-shell-ui): drop section, notices, trash, details, breadcrumb, search, sort and upload menu items, view toggle, empty trash and selection actions. Props and behaviour are unchanged.
