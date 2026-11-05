# 20261104-1110-trash-retention Trash retention and multi-select actions

- **status**: completed
- **approvedAt**: 2026-11-04 11:15
- **createdAt**: 2026-11-04 11:10
- **relatedTask**: 20261103-0508-trash-retention

## Context

- `FmMount.trash?: boolean`; `server/trash.ts` stores `/.fm-trash/<id>/<name>` + `<id>.json` (`deletedAt`). Routes: list, restore (ids), purge (ids). "Empty trash" exists in the UI.
- `trash-view.tsx`: table with per-row restore / delete forever; no selection, newest first.

## Proposal

1. **Retention**: `FmMount.trash?: boolean | { retentionDays: number }`. Expired items (`deletedAt + days`) are purged lazily on `GET /trash` (best effort, failures ignored) and by an exported `purgeExpired(mount, now?)` for host cron. `FmMountInfo` gains `trashRetentionDays?: number`; `FmTrashItem` gains `expiresAt?`.
2. **Trash view**: checkbox column with select-all, click / Ctrl / Shift selection on rows, Ctrl+A, Delete (→ confirm delete forever), toolbar "Restore (n)" / "Delete forever (n)" when something is selected; "Expires in n days" column and a note "Items are deleted forever after n days" when retention is set; sortable by name / deleted date.
3. Labels (en / zh), README mount option.

## Risks

- Lazy purge on list makes `GET` mutate; bounded to expired items and mirrors bithk. Hosts wanting no side effects use `purgeExpired` from cron and `trash: true`.

## Scope

`registry/fm/server/router.ts`, `server/trash.ts`, `core/schema.ts`, `react/trash-view.tsx`, `react/labels.ts`, router tests, e2e, README, changelog.

## Verification

Router tests (expiry with injected `now`, lazy purge on list, `purgeExpired`, mount info), `bun run check`, e2e (multi-select restore and delete forever, retention note).

## Annotations

2026-11-04: user approved ("go").

## As built

- `FmMount.trash?: boolean | { retentionDays }`; `GET /trash` purges expired items first (`purgeExpiredItems` in `server/trash.ts`) and returns `expiresAt`; `purgeExpired(mount, now?)` exported from `server/router.ts` (no-op on read-only mounts or without retention). `FmMountInfo.trashRetentionDays`.
- `TrashView`: shadcn Checkbox column + select-all (indeterminate), click / Ctrl / Shift row selection, Ctrl+A, Delete → confirm, Esc clears; bulk bar "n selected · Restore · Delete forever"; name / deleted sort; "Expires" column and retention note. fm-react gains the `checkbox` registry dependency.
- Demo: local mount uses `retentionDays: 30`. README documents the option.
- Verified: `bun run check` (244 tests, new router test for expiry / lazy purge / `purgeExpired`), `registry:smoke`, e2e 63/63 (new multi-select restore / delete test).
