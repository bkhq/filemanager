# 20261111-1600-compact-folder-toolbar Compact folder toolbar in the workspace header

- **status**: completed
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-11-11 16:00

## Description

At mid widths (about 640–760px, e.g. embedded in a host panel with `headerActions`) the workspace header wrapped to two rows and squeezed the path to a few characters: ten icon buttons plus a fixed `w-64` search box.

- The header stays on one row at 640px and wider (it still wraps below that); the path keeps `min-w-24` and the search box shrinks down to `min-w-40` before the path gives way.
- New folder, new text file and upload share one "New" menu (`labels.newMenu`).
- Sort and the list / grid toggle share one "View" menu (`labels.viewMenu`, new); the trigger shows the current view's icon.

The narrow "More" menu, the explorer row and the drive shell are unchanged.

## ActiveForm

Compacting the workspace folder toolbar

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Approved in chat, no separate plan. e2e: `header-actions.spec.ts` "mid-width manager"; `fm.spec.ts` uses the `toolbarNew` / `toolbarView` helpers.
