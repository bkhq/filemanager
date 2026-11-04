# 20261104-0558-explorer-parity Explorer parity campaign (bks / bkd review)

- **status**: implementing
- **createdAt**: 2026-11-04 05:58
- **approvedAt**: 2026-11-04 06:09
- **relatedTask**: (campaign; covers the four tasks below)

## Context

The bks (`/srv/ai/bks/apps/web/src/shared/components/file-browser`) and bkd (`/srv/ai/bkd/apps/{api,frontend}` files) review listed gaps that fit filemanager. Groups A (small) and B (medium) are in scope; group C stays in existing tasks (ui-polish: virtualized tree, bkd-pilot: FileDrawer, trash-retention, pick-mode follow-ups). Base: `main` at `3d2b576` (tree + preview layout).

| Item | Gap | Workstream |
|---|---|---|
| A1 | Ctrl+S, unsaved marker, discard | editor |
| A2 | word-wrap toggle | editor |
| A3 | copy path / copy name | browser-shell |
| A4 | new file / folder / upload in the clicked folder | browser-shell |
| A5 | collapse all | browser-shell |
| A6 | show hidden files toggle | listing |
| A7 | PDF without the browser toolbar | previews |
| B1 | binary sniff for extensionless files | previews |
| B2 | large text files open truncated, read-only | editor |
| B3 | save conflict: overwrite / reload / keep | editor |
| B4 | persisted drafts | editor |
| B5 | Markdown rendered view (plugin) | previews |
| B6 | git-ignored entries in listings + toggle | listing |
| B7 | remember last location and open file | browser-shell |
| B8 | phone: tree / preview switch instead of the list | browser-shell |

## Proposal

Four L2 workstreams, all parallel: [editor](20261104-0558-editor.md), [browser-shell](20261104-0558-browser-shell.md), [listing](20261104-0558-listing.md), [previews](20261104-0558-previews.md). Overlaps (`file-manager.tsx`, `labels.ts`, e2e spec, `registry.json`) are additive; L1 merges in completion order and resolves them. New dependencies only for the Markdown plugin (previews). Merge locally, never push.

## Risks

- Conflicts in `file-manager.tsx` between browser-shell and listing (tree toolbar) and in the e2e spec for all four.
- Markdown plugin adds runtime dependencies to an optional registry item.

## Scope

4 tasks, 15 items; registry/fm react, server list route, local driver, new markdown plugin, fm-web / fm-api demo wiring, e2e.

## Alternatives

- One workstream per item: more parallelism, many more conflicts.

## Annotations

2026-11-04 06:09: user confirmed dispatch (`go`); auto mode not enabled, so every L2 -> main merge waits for user confirmation. campaignId `l1-d4j0p0gu-20261104060841`, baseBranch `main` (`0a47c3d`).

2026-11-04: user asked to implement groups A and B, write requirement docs with PMA and process them with BKD L1.

## Decisions

- decision: A — message `3ldfc9h8`: the guard's "Discard" also clears the persisted draft (editor, both guard sites, with an e2e).
- decision: A — message `ahizn0ph`: `client.readText` gains a `range` option; the large-file read uses it so a host `fetch` applies (editor scope extended to `client.ts`).
- listing: `git check-ignore` rejects `--literal-pathspecs`; names are passed with a `./` prefix instead (test covers `:(top)` names). Accepted.

- 2026-11-04 integration trial (listing -> previews -> editor -> browser-shell in a scratch worktree): conflicts resolved in `file-manager.tsx` (listing toggles + `filter` moved into browser-shell's `treePane`), `file-tree.tsx` (`dimmed` + lifted expansion), `client.test.ts` (missing `});` between appended tests), changelog (both entries). Result: `bun run check` 242 pass, registry smoke OK, e2e 50 / 51 — B7 reopened the preview dialog on reload in the list layout. User confirmed (`ok`): browser-shell restores the open file only in the tree + preview layout; then merge all four; follow-up: `client.read(..., { range })` for the sniff and sheet reads, `clearDrafts` on rename / delete.

## Status

| Workstream | L2 issue | State | Merge SHA |
|---|---|---|---|
| editor | h10kua0k | dispatched | - |
| browser-shell | baikc887 | dispatched | - |
| listing | xevmk1iw | dispatched | - |
| previews | ld1vvq5p | dispatched | - |
