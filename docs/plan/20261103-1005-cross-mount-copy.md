# 20261103-1005-cross-mount-copy Cross-mount copy and move

- **status**: completed
- **createdAt**: 2026-11-03 10:05
- **approvedAt**: 2026-11-03 11:26
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

## As built

- `POST /m/:mount/ops` move / copy accept `destMount`; same mount or absent keeps the driver `move` / `copy` path.
- Another mount: `copy|move` on the source and `write` on the destination are authorized; the source walk is bounded by `archiveMaxEntries` / `archiveMaxBytes` before anything is written; each file is streamed `read -> write`, and a failed item removes its partial copy.
- `move` deletes the source (to the trash when enabled) only after the whole item was copied.
- Change events for cross-mount items carry `toMount` (architecture §3.3).
- UI: paste into another mount; tree drop moves within the same mount and copies onto another mount.
- "Copy contents" context action for text files up to 1 MiB (clipboard API), gated by `features.download`.
- Cross-mount operations have no undo.
