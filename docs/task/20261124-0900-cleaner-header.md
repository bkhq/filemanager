# 20261124-0900-cleaner-header Cleaner workspace header: search icon, path ellipsis, folded toolbar

- **status**: completed
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-11-24 09:00

## Description

The workspace header crowded at medium widths: the search box squeezed under the toolbar and long paths pushed the layout buttons.

- Workspace search is an icon button (`ShellSearch` `collapsible`); it expands into the scope menu + input, stays open while there is a query, and folds on Escape, on blur when empty, or when the query is cleared from elsewhere (opening a hit). The drive shell keeps its always-open box in its own row.
- The search box no longer shrinks below its `min-w-40` (it used to overflow onto the toolbar after it).
- The quick-open button leaves the toolbar; quick open stays on Ctrl/Cmd+P (listed in the shortcuts help).
- `PathBar` with four or more steps after the mount shows the mount, the first folder, `…` (`labels.collapsedPath`) and the last two steps; `…` opens a menu of the folded folders, which navigate.
- A main header narrower than `FOLD` (760px, measured on the header) folds the folder toolbar into the existing "More" menu while path, search and host actions stay on one row.
- Demo: seed `samples/project/src/shared/components/button.tsx` for a long path, and a Width switch (full / 720px / 480px, `fm-web:width`) to show the folding without resizing the window.

## ActiveForm

Cleaning up the workspace header

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Approved in chat, no separate plan. e2e: `fm.spec.ts` "search sits behind a button…", "the path bar folds the middle of a long path"; `header-actions.spec.ts` "mid-width manager" now expects the folded toolbar.
