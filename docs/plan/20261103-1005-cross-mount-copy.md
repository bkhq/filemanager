# 20261103-1005-cross-mount-copy Cross-mount copy and move

- **status**: draft
- **createdAt**: 2026-11-03 10:05
- **approvedAt**: (pending)
- **relatedTask**: 20261103-0508-cross-mount-copy

## Context

`POST /m/:mount/ops` (`registry/fm/server/router.ts:451-522`) resolves `dest` on the same mount and calls `driver.move` / `driver.copy`. `archive.ts:20` (`collect`) walks a tree with `archiveMaxEntries` / `archiveMaxBytes`. The UI clipboard already stores `mount` (`react/state.ts:78-82`); paste and drag reject other mounts in `react/file-manager.tsx`. Wave 2: starts after wave 1 is merged (change events must fire for cross-mount items too).

## Proposal

- `opsRequestSchema` move / copy gain `destMount?: string` (`core/schema.ts`). Same mount or absent -> unchanged.
- Different mount: authorize `read` + `copy|move` on the source and `write` on the destination; walk the source (reuse `collect` limits), `mkdir` folders, stream each file `read -> write` without buffering beyond the driver; for `move`, delete the source (to trash when enabled) only after all of that item's files were written. Conflict handling as today.
- Per-item results as today; a failed move leaves the source untouched. Change events fire per item.
- UI: paste into another mount; drop onto another mount / folder in the tree.
- Context action "Copy contents" for text files up to 1 MiB (clipboard API).

## Acceptance

- Router tests memory -> local and local -> memory: file, folder, conflict modes, auth denied on either side, partial failure keeps the source.
- e2e: copy a folder from Local disk to Scratch via paste.
- `bun run check` and `bun run test:e2e` pass.

## Risks

- Long copies inside one request (Workers limits); bounded by the walk limits, documented.

## Scope

`core/schema.ts`, `server/router.ts`, `server/router.test.ts`, `client/client.ts`, `react/file-manager.tsx`, `react/file-tree.tsx`, `react/labels.ts`, `tests/e2e/fm.spec.ts`.

## Alternatives

- Client-driven copy (download + upload per file): no server change, doubles traffic, no atomic source delete.
