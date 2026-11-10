# 20261110-0700-filen-audit-fixes Audit against Filen and fixes

- **status**: implemented
- **createdAt**: 2026-11-10 07:00
- **approvedAt**: 2026-11-10 07:10
- **relatedTask**: 20261110-0700-walk-authorize, 20261110-0700-s3-large-copy, 20261110-0700-conditional-writes, 20261110-0700-list-paging-cost, 20261110-0700-walk-thumb-budget, 20261110-0700-upload-throughput, 20261110-0700-markdown-remote-images, 20261110-0700-spring-loaded-folders, 20261110-0700-shortcuts-help

## Context

Survey of the public FilenCloudDienste repositories (cloned under `.tmp/`, not tracked) and an audit of this codebase at `d90448a` (360 unit tests: 357 pass, 3 skip).

### Reference projects

| Repository | What it is | Licence | Use for us |
|---|---|---|---|
| `filen-ts` | All Filen clients: `filen-web` (Vite + React, ~300k lines, 943 unit test files), `filen-mobile` (Expo), `filen-desktop` (Electron), shared packages, office engines | AGPL-3.0 | UX and front-end practice only |
| `filen-rs` | Client SDK in Rust (crypto, chunked transfers, jobs, sync engine, cache), shipped as wasm / napi / uniffi; `filen-cli` | AGPL-3.0 | Transfer scheduling and resource budgets |
| `filen-relay` | Self-hosted gateway: SQLite share table in front of `rclone serve` (Web / WebDAV / S3) | no licence file | Product shape of shares / protocol exits only |
| Filen server | Not public (end-to-end encrypted product: clients are open, server is closed) | — | — |

No code can be copied (AGPL / unlicensed vs. our MIT); only ideas.

### Ideas worth taking

- Transfers (filen-rs `consts.rs`, `job/`, `auth/unauth.rs`; filen-web `features/transfers`): parallel chunks within one file; memory / open-file / thumbnail / archive budgets as semaphores; pausable jobs that drain in-flight chunks first; retry budget; one batched progress channel instead of a store write per progress event; one transfer centre for uploads, downloads and jobs; leave-page guard while transfers run (`lib/unloadGuard.ts`).
- Interaction (filen-web `features/drive`): central keymap registry with conflict detection and a `?` shortcuts dialog (`lib/keymap/`); spring-loaded folders while dragging (`springLoad.ts`); clipboard that follows its items through renames and moves (`clipboardSync.ts`); viewport-ranked thumbnail queue with bounded object-URL cache (`thumbnails.ts`, `thumbnailRank.ts`); remote-change prompt while editing (`usePreviewRemoteChanges.ts`); live updates instead of polling (`socketHandlers.ts`).
- Practice: pure logic in `*.logic.ts` next to components, tested on its own.

### Not to take

- filen-relay stores share passwords in plain text and checks `auth_header.ends_with(password)` (`backend/server_manager.rs:165`): a future share feature must hash passwords and compare in constant time.
- End-to-end encryption (conflicts with server-side previews, zip, git, diff, thumbnails), the sync engine, office engines, i18next, service-worker downloads, filen-web's dependency patch set.

## Audit findings

Correction to an earlier remark: `react/file-list.tsx:372` is already virtualized.

### Security

- **S1 (medium-high) Walks skip per-path authorization.** `/archive` (`server/router.ts:1122` → `server/archive.ts:20` `collect`), `/usage` (`router.ts:1160`), cross-mount `transfer` (`router.ts:541`) and same-mount `copy` authorize only the top path and walk below it, skipping only hidden folders. `/search` checks every directory (`capsOf`), `/changes` and `/trash` every item. With `authorize` allowing `/team` and denying `/team/hr`, reading `/team/hr/x` answers 404 but zipping `/team` returns `hr`. The `authorize` doc ("for `path` and everything below it") is ambiguous.
- **S2 (medium) Check-then-write races.** local `prepareWrite` (`drivers/local.ts:445`) stats then renames; s3 `checkTarget` (`drivers/s3.ts:283`) HEADs then PUTs, so `ifMatch` / `exclusive` can be lost under concurrency. `/write` with `conflict: "rename"` picks a free name (`router.ts:528`) and writes without `exclusive`, so two concurrent uploads of one name overwrite each other.
- **S3 (low) Markdown preview loads any remote image.** streamdown 2.7.1 defaults to `allowedImagePrefixes: ["*"]` (`plugins/markdown-view.tsx:21`): previewing an untrusted `.md` leaks the viewer's IP and time to third parties. Raw HTML is sanitized.
- **S4 (low) Thumbnail endpoint as a resource sink.** Up to 32 MB source images decoded on every request (`router.ts:913`, `thumbnails/bun.ts`), no server cache, no concurrency bound.
- Done well: sandbox CSP + nosniff on `/read`, script types downgraded, RFC 5987 filenames, realpath root jail incl. symlinks, hardened git invocations, hidden folders 404 everywhere, re-authorized upload sessions, preflighted mutations.

### Performance

- **P1 (high) Paged listing is O(n²).** `/list` (`router.ts:674`) runs a full `driver.list` per page, then filters, sorts and slices. local stats every entry serially (`local.ts:606`), probes each folder with `opendir`, and runs `git check-ignore` per call. A 10 000-entry folder in 20 pages of 500 is ~200 000 stats and 20 git processes; S3 re-pages ListObjectsV2 each time.
- **P2 (medium) Extra stat per walked entry.** `collect` (`archive.ts:24`) stats every child although `list` already returned kind, size and mtime: one HEAD per object on S3.
- **P3 (medium) No server concurrency budget** for zip, cross-mount copy, thumbnails and walks.
- **P4 (medium) Upload client.** Parts of one file go serially (`client/upload.ts:215`); every XHR progress event maps and sets the whole task list (`upload.ts:228`).

### Reliability

- **R1 (medium) S3 cannot move / rename / copy objects over 5 GiB.** `copyObject` (`s3.ts:272`) is a single `x-amz-copy-source` PUT (S3 limit 5 GiB) while upload sessions allow 10 GiB. A 200 response carrying an `<Error>` body is not detected.
- **R2 (medium) S3 folder move is not atomic.** Copy all, then delete; a failure midway leaves duplicates with no cleanup.
- **R3 (low) Session sweep cost.** `sweepUploads` (`router.ts:1481`) lists `/.fm-uploads` and reads session records on every session create.

### Design and architecture

- `server/router.ts` is 1 639 lines in one factory closure; three separate BFS walks (archive, usage, search) with diverging authorization (the cause of S1).
- `react/use-commands.ts` (647) and `react/file-tree.tsx` (739) carry untested logic; `react/` has far fewer unit tests than server / drivers; 3 e2e specs.
- `options.mounts(c)` and `authorize` run per call, several times per request on `/changes` and `/trash`: costly for hosts that hit a database.

## Proposal

Fix in two independent workstreams with disjoint write scopes; defer the rest.

### Workstream A — server security, reliability, performance

Scope: `registry/fm/server/**`, `registry/fm/drivers/**`, `registry/fm/thumbnails/**`, `registry/fm/core/**` as needed, their tests, `docs/architecture.md` (authorize semantics).

1. `20261110-0700-walk-authorize` (S1): one shared walk helper used by archive, usage, search fallback and cross-mount transfer, calling `authorize` per directory. Archive / usage / search skip unreadable subtrees; copy (same- or cross-mount) and cross-mount move answer FORBIDDEN when the source holds an unreadable subtree. Same-mount move stays as is (it does not expose content). Document the semantics.
2. `20261110-0700-s3-large-copy` (R1, R2): UploadPartCopy above 5 GiB; detect 200-with-`<Error>`; folder move removes the copied objects when the copy fails.
3. `20261110-0700-conditional-writes` (S2): s3 conditional PUT (`If-None-Match: *`, `If-Match`), r2 `onlyIf`; `/write` and upload sessions with `conflict: "rename"` write exclusively and retry the next free name on EXISTS; local overwrite race documented.
4. `20261110-0700-list-paging-cost` (P1): short-lived listing snapshot in the router (cursor carries the snapshot id, dropped on any mutation of the mount through the router, re-list on miss); local `list` stats with bounded concurrency.
5. `20261110-0700-walk-thumb-budget` (P2, S4, P3, R3): walks use listed metadata; thumbnail hook behind a concurrency limit (`FmLimits`); bounded session sweep.

### Workstream B — client and UI

Scope: `registry/fm/client/**`, `registry/fm/react/**`, `registry/fm/plugins/**`, `apps/fm-web/**`, `tests/e2e/**`.

1. `20261110-0700-upload-throughput` (P4): 2–4 parallel parts per file (option), progress coalesced per frame / 100 ms, leave-page guard while uploads run, pause / resume of queued and running tasks.
2. `20261110-0700-markdown-remote-images` (S3): remote images off by default (same-origin and data URIs only), host opt-in.
3. `20261110-0700-spring-loaded-folders`: a drag resting on a folder (tree, list, path bar) opens it after a delay.
4. `20261110-0700-shortcuts-help`: one shortcuts catalog for the existing bindings and a `?` dialog.

### Deferred (not in this campaign)

Split `router.ts` into route modules (after workstream A lands), extract `use-commands` logic with tests, SSE watch, transfer centre for downloads / jobs, video / PDF thumbnails, request-scoped mounts / authorize cache, managed store, share plugin.

## Risks

- S1 changes authorization behaviour: hosts relying on top-level-only checks see FORBIDDEN on copies of mixed folders.
- Conditional PUT support differs across S3-compatible servers; RustFS must pass the contract or the driver keeps a fallback.
- The listing snapshot must never serve stale data after a mutation through the router; external changes show up after the snapshot TTL.
- Both workstreams may add files to `registry.json`; conflicts are resolved at integration.

## Scope

As listed per workstream. Neither workstream edits `docs/task/**`, `docs/plan/**` or `docs/changelog.md`; those are updated at integration.

## Verification

- Every finding gets a failing test first (router / driver / contract / client unit tests; e2e for UI items).
- `bun run check` passes on each branch, with `FM_TEST_S3_ENDPOINT` pointing at a RustFS container for workstream A.
- `bun run test:e2e` passes for workstream B.
- Integration: both branches combined, `bun run check` and `bun run test:e2e` pass; changes are left uncommitted in the main worktree for code review.

## Annotations

- Approved with the recommended options: copies / cross-mount moves of a source holding an unreadable subtree answer FORBIDDEN (no partial copies); pause / resume stays in upload-throughput.
- Executed as BKD campaign `l1-9muv8v7b-20261110-0700` (L1 issue 9muv8v7b, one L2 per workstream). Changes are integrated into the main worktree uncommitted for code review.
- 2026-11-10 08:20: both workstreams integrated (server bkd/3otl812q @ e20753c, client-ui bkd/zd2gjfz8 @ 8d48700, combined on local branch bkd-int/l1-9muv8v7b) and squashed into the main worktree uncommitted for code review. L1 review sent one fix back (sweep throttle and list snapshots keyed by driver identity broke with per-request drivers; fixed in L3 mrt2cdhp). Known limits: `/write` rename race found after the body was sent and rename races on driver-multipart sessions answer 409; r2 multipart complete and local `ifMatch` stay check-then-write; external changes reach later list pages after the 5 s snapshot TTL, and per-request drivers re-list every page; same-mount copy with `authorize` walks the whole source unbounded; the sweep throttle keeps one entry per mount id; Markdown images without a `./` or `/` prefix stay blocked by streamdown.
- 2026-11-10 09:00: code review found one regression (zip of a mount root named its top entry `root//`); fixed in L3 i06wdo80 (bkd/3otl812q @ c0feaa2) and applied to the main worktree. `bun run check` on the worktree: 444 pass, 3 skip, 0 fail (S3 contract not run; no s3 / r2 change since the RustFS run).
