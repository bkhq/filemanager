# 20261106-0913-subfolder-hint Subfolder hints on folder entries

- **status**: completed
- **createdAt**: 2026-11-06 09:13
- **approvedAt**: 2026-11-06 09:20
- **relatedTask**: 20261106-0913-subfolder-hint

## Context

- The drive tree lists folders only (`FileTree.foldersOnly`). A folder becomes a leaf (no chevron) only after its own listing is loaded; folders not opened yet show a chevron even when they hold only files.
- Entries come from `FmDriver.list` (`server/driver.ts` `FmDriverEntry`) through the router's `toEntry` (`server/router.ts`), which already passes optional fields (`ignored`, `id`, `extra`).
- Costs per driver: memory knows its children in memory; local can check a folder with `opendir` and stop at the first subfolder; S3 / R2 need one delimiter listing per folder (a request each); a database-backed driver (bithk adapter, managed store) can answer in the same query.

## Proposal

1. **Protocol**: optional `hasSubfolders?: boolean` on folder entries (`FmDriverEntry`, `entrySchema`), passed through `list` / `stat` / `search` by `toEntry`. Absent = unknown.
2. **Drivers**:
   - memory: always set.
   - local: set in `list` for each child folder with `opendir`, stopping at the first folder entry or after 256 entries (then unknown); symlinked folders and hidden entries follow the existing listing rules.
   - S3 / R2: not set (one extra request per folder is not worth it).
3. **Tree**: in `foldersOnly` mode a folder with `hasSubfolders === false` is a leaf before it is opened; unknown keeps today's behaviour (leaf once listed and empty).
4. **Contract**: `runDriverContract` checks that `hasSubfolders`, when a driver sets it, matches the folder's children.
5. **Docs**: README "Writing a driver" mentions the hint; architecture entry fields; changelog.

## Risks

- Local listings of folders with many subfolders do one extra directory read per child folder (bounded at 256 entries each). Measured cost goes into the changelog; if it matters, the hint becomes a `localDriver` option.
- Hints go stale when another client adds a subfolder; the tree corrects itself when the folder is listed (refresh, open).

## Scope

`core/schema.ts`, `server/driver.ts`, `server/router.ts` (+ test), `server/contract.ts`, `drivers/memory.ts`, `drivers/local.ts` (+ test), `react/file-tree.tsx`, `tests/e2e/drive.spec.ts`, README, `docs/architecture.md`, changelog.

## Verification

- Router test: `hasSubfolders` passes through list / stat / search; absent stays absent.
- Driver tests: memory and local set it correctly (folder with files only, with a subfolder, empty); local gives up past the bound.
- Contract suite passes for memory, local, S3 (MinIO, not set) and R2 (miniflare, not set).
- e2e (drive): a collapsed folder holding only files shows no chevron before it is opened; one with a subfolder keeps it.
- `bun run check`, full e2e, `registry:smoke`.

## Alternatives

- **Prefetch the listings of visible folders in the tree**: no protocol change, but one request per visible folder from every client.
- **Keep the client-side fix only** (today): correct after a folder is opened once.

## Annotations

- Local hints read child folders 32 at a time; 1 000 folders list in about 38 ms instead of 24 ms, so the hint stays on without an option. Symlinks make the hint unknown rather than following them.
