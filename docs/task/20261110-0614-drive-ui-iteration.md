# 20261110-0614-drive-ui-iteration Drive and workspace UI iteration

- **status**: completed
- **priority**: P2
- **owner**: agent/drive-ui-iteration
- **createdAt**: 2026-11-10 06:14

## Description

Drive and workspace UI work inspired by the Filen web drive (ideas only; its code is AGPL and was not copied). Merges the tasks 20261109-1815-drive-ui-refresh, 20261110-0235-workspace-roomy-single, 20261110-0253-more-button-stays, 20261110-0325-unify-toolbar-path, 20261110-0420-wheel-zoom-step, 20261110-0510-demo-view-switch, 20261110-0540-resizable-preview-splits and 20261110-0620-sheet-column-resize.

1. Drive look for listings: taller rows, list thumbnails, more button (kept while its menu is open), square tiles, columns by container width; drive always, workspace outside pick mode.
2. Drive toolbar in two rows; floating selection bar at the bottom centre with a red delete; workspace sort as an icon.
3. Path bar with pickers in the list views; folders navigate.
4. Storage menu: no back-to-back separators; section icons in the menu colour.
5. Image wheel zoom by a fixed factor per notch.
6. Resizable archive and Markdown splits, resizable spreadsheet columns.
7. Demo View menu (Workspace / Drive).

Details: docs/plan/20261110-0614-drive-ui-iteration.md.

## ActiveForm

Iterating on the drive and workspace UI

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- complete: Verified: bun run check (357 unit tests), 122 e2e, registry smoke.
