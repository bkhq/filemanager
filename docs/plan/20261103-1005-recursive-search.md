# 20261103-1005-recursive-search Recursive search

- **status**: completed
- **createdAt**: 2026-11-03 10:05
- **approvedAt**: 2026-11-03 10:12
- **relatedTask**: 20261103-0508-recursive-search

## Context

Search today is `list?q=` (`registry/fm/server/router.ts:296-352`, filter at line ~318): current folder only. `archive.ts:20` (`collect`) already walks a tree with entry / byte limits. Trash is hidden via `hidden()` (`router.ts:167`). Caps per path come from `resolve()` (176) / `authorize`. The UI search box lives in `registry/fm/react/file-manager.tsx` (toolbar); client calls are in `registry/fm/client/client.ts:84-125`, hooks in `client/hooks.ts`.

## Proposal

- Optional driver method `search?(dir: string, q: string, opts: { limit: number; signal?: AbortSignal }): Promise<FmDriverEntry[]>` on `FmDriver` (`server/driver.ts:45`).
- Route `GET /m/:mount/search?path&q&limit` (limit default 100, max 500): uses `driver.search` when present, else a bounded breadth-first walk (reuse `FmLimits.archiveMaxEntries` as the visit budget). Case-insensitive substring match on the name. Skips trash; applies `authorize` per hit (no `read` -> omitted). Response `{ items: FmEntry[], truncated: boolean }` with a zod schema in `core/schema.ts` (`fmSearchResultSchema` / `FmSearchResult`).
- Client: `search(mount, path, q, limit?)` and `useSearch` hook.
- UI: when the search box is non-empty, a scope toggle "This folder / Everywhere below"; results show the parent path and opening a result navigates to its folder and selects it.
- Labels for en / zh.

## Acceptance

- Router tests: hits in nested folders, trash excluded, unauthorized subtree excluded, `truncated` set when the budget is hit, driver `search` preferred when present.
- e2e: search "everywhere below" finds a nested file and opens its folder.
- `bun run check` and `bun run test:e2e` pass.

## Risks

- Walk cost on S3 (one list per prefix); bounded by the visit budget and `truncated`.

## Scope

`server/driver.ts`, `server/router.ts`, `server/router.test.ts`, `core/schema.ts`, `client/client.ts`, `client/hooks.ts`, `react/file-manager.tsx`, `react/labels.ts`, `tests/e2e/fm.spec.ts`.

## Alternatives

- Client-side recursive listing: no server change, many round-trips, no per-hit authorization on the server.
