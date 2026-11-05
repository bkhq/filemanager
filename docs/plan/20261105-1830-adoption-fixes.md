# 20261105-1830-adoption-fixes Upstream fixes from the bks adoption review

- **status**: completed
- **createdAt**: 2026-11-05 18:30
- **approvedAt**: 2026-11-05 18:30
- **relatedTask**: 20261103-0508-bkd-pilot (adoption prerequisites; reported by bks issue zblk31je)

## Context

bks's adoption plan (bks `docs/plan/20261105-1016-adopt-file-manager.md`) found four gaps, all confirmed in the code:

1. Flat storages (folders implied by file paths) lose an empty folder right after `mkdir`, because the listing refreshes from the driver.
2. Uploads ≥ 16 MiB always use upload sessions; without driver multipart the parts are written into the driver as hidden files (`/.fm-uploads/…`) — a commit per part on bks skills, debris on runner workspaces. There is no way to turn sessions off.
3. `runDriverContract` assumes an empty root, empty directories and directory copy.
4. Tree rows have no `data-path` (list rows do).

## Proposal

1. `FmMount.implicitFolders` → `FmMountInfo.implicitFolders`: the UI keeps folders created on such mounts client-side (merged into list and tree listings, an empty listing when the driver answers NOT_FOUND for them) until a file lands in them, they are renamed / moved / deleted, or the page reloads.
2. `FmMount.uploads?: boolean` (default true) → `FmMountInfo.uploadSessions`: false makes the router refuse `POST /uploads` (405) and the client send every file with one `PUT /write` (still bounded by `maxUploadBytes`).
3. `runDriverContract(label, make, { seeded?, emptyDirs?, copyDirs? })`: `seeded` paths a fresh driver already holds are ignored in root listings; `emptyDirs: false` skips empty-directory cases; `copyDirs: false` skips directory copy.
4. Tree rows carry `data-tree-path` and `data-tree-mount` (list rows keep `data-path`).

## Verification

Unit tests (contract options against memory with seeded files, router refusing sessions, upload queue choosing single PUT), e2e (implicit folder survives the refresh, can be entered and uploaded into), `bun run check`, `registry:smoke`.

## As built

- `FmMount.implicitFolders` / `FmMountInfo.implicitFolders`: `FileManager` keeps created folders per mount, merges them into the list (folder view, not search) and tree listings, treats a 404 listing of such a folder as empty (with the mount's caps, so uploads work), and drops them after delete / rename / move; a reload forgets them.
- `FmMount.uploads: false` / `FmMountInfo.uploadSessions`: `POST /uploads` answers 405; `createUploadQueue({ sessions })` lets `FileManager` send those mounts' files with one PUT.
- `runDriverContract(label, make, { seeded, emptyDirs, copyDirs })`; the memory driver runs it both ways.
- Tree rows: `data-tree-path` / `data-tree-mount` (not `data-path`, which list rows use and tests select on).
- Verified: `bun run check` (299 tests), `registry:smoke`, e2e 83/83 (implicit folder simulated by intercepting the scratch mount: survives the refresh, opens empty without an error, takes an upload).
