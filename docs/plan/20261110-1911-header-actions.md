# 20261110-1911-header-actions Host actions in the file manager's top bar

- **status**: implemented
- **createdAt**: 2026-11-10 19:11
- **approvedAt**: 2026-11-10 19:11
- **relatedTask**: 20261110-1911-header-actions

## Context

Hosts that embed `<FileManager />` in a panel (BKD's issue workspace) need panel controls (maximize / restore, close) next to it. Today they add a title bar above the manager, which stacks two headers, or float buttons over it, which covers the explorer's "More" button in the top-right corner.

## Proposal

Optional `headerActions?: ReactNode` on `FileManagerProps`, rendered once, at the right end of the bar that touches the manager's top-right corner:

| Layout | Bar |
|---|---|
| split, wide | main pane `<header>`, after its toolbars |
| split, narrow, tree view | explorer title row (`WorkspaceTreePane`), after "More", outside the hover toolbar |
| split, narrow, main view | main pane `<header>` |
| single | main pane `<header>` |
| trash | main pane `<header>`, after "Empty trash" |

Wrapped in `<div className="ml-auto flex shrink-0 items-center gap-0.5">` (`ml-auto` keeps it in the corner when the bar does not fill the row); fm does not style the children. Ignored in pick mode (`FilePicker`). `DriveManager` does not take it (`FmDriveManagerProps` omits it).

Out of scope: renaming "Explorer" (`labels.explorer` exists), a host title / icon slot.

## Scope

`react/file-manager.tsx`, `react/workspace-shell.tsx`, `react/workspace-tree-pane.tsx`, `react/drive-manager.tsx`, `react/file-manager.test.ts`, `apps/fm-web/src/app.tsx` (`?actions` demo), `tests/e2e/fm.spec.ts`, README.

## Verification

Unit (happy-dom): rendered once in the main header for wide split and single; once in the explorer row (not in the main header) for the narrow tree view; no wrapper without the prop. e2e: narrow main view, trash view, and the explorer row keeps the actions visible while its hover toolbar is collapsed. `bun run check`.

## Annotations
- Implemented as proposed; the wrapper adds `ml-auto` so the actions keep the corner when the bar does not fill its row (trash view). The e2e fixture lives in `/0-header-actions/` so it stays on the tree's first screen after the serial specs filled the shared root.
