# 20261106-0830-drive-tree-layout Drive view: folder tree + folder contents + preview dialog

- **status**: completed
- **createdAt**: 2026-11-06 08:30
- **approvedAt**: 2026-11-06 08:40
- **relatedTask**: 20261106-0830-drive-tree-layout

## Context

- Target host: bithk. Wanted interaction (2026-11-06 discussion): keep today's look; click a folder in the left tree → the right side lists that folder; click a file → preview dialog with the matching previewer. No Changes section.
- Today's workspace (`FileManager`, `fm-react`) in the split layout is an explorer: the right side shows the open file inline (`explorer = split && !pick`, `react/use-listing-state.ts:115`), so clicking a folder leaves the previous file on the right. The single layout lists the folder and opens files in `PreviewDialog`, but has no tree.
- The first drive version (`fm-drive`: `drive-manager.tsx` 19 lines, `drive-shell.tsx` 451, `drive-nav.tsx` 83, `drive-ref-list.tsx` 47) uses a spaces navigation instead of a tree, plus its own Recent / Starred list views. `useFileManager(props, "drive")` turns off the split layout, quick open, change queries and the hidden / ignored toggles (`use-view-state.ts`, `use-commands.ts`, `use-changes.tsx`).
- Reusable pieces in `fm-react`: `FileTree` with sections (Starred, Recent) and per-mount Trash rows, its context menus and drag targets (`react/workspace-tree-pane.tsx`, the `<ScrollArea>` part); `treeFilter` (`use-listing-state.ts:63`) filters tree listings; `ManagerList` (list / grid with context menus); `PreviewDialog`; the resizable tree | main | details panels and the narrow stacked mode (`stacked`, `treeOnly`, `narrowPane`) in `workspace-shell.tsx`.

## Proposal

### Layout

| Area | Behaviour |
|---|---|
| Left: tree | Same tree as the workspace: spaces (mounts) at the top level, Starred and Recent sections when `meta` provides them, a Trash row per mount with a trash. **Folders only**. A small header (title, "Manage drives" stays at the bottom as today). No Changes section, no explorer "More" menu (no hidden / ignored / review toggles). Resizable, width persisted. |
| Click a tree folder / space | The right side lists it; the tree highlights and expands it (existing navigation). |
| Click a Starred / Recent file | Preview dialog; a folder there navigates. |
| Right: header | Path, search (this folder / everywhere below), grid / list toggle, details toggle, "New" menu (folder, text file), "Upload" menu (files, folder). Kept from the first drive version. |
| Right: bar | Filter and sort when nothing is selected; the batch bar (count, download, copy, cut, rename, host actions, delete) when something is. Kept. |
| Right: content | `ManagerList`, grid by default (stored apart from the workspace view); double-click a folder enters it, double-click a file opens `PreviewDialog` (steps through the folder's files). |
| Details | Side panel (resizable) on wide containers, overlay on narrow ones. |
| Narrow containers | Tree or list one at a time with a back button (existing stacked mode). |
| Off in drive | Changes section and change badges, review, quick open, inline editor pane, hidden / git-ignored toggles. |

### Implementation

1. **Hooks (`fm-react`)**: in drive mode keep the split / stacked layout rules (tree shown) but never act as the explorer: `explorer = split && !pick && !drive`, so files open in the preview dialog and the last location restores without reopening a file. `treeFilter` keeps folders only in drive mode. Starred / Recent sections get `onOpen` = preview for files in drive mode. Change queries stay off (as today).
2. **Shared tree (`fm-react`)**: move the `<ScrollArea>` + context menu + `FileTree` part of `workspace-tree-pane.tsx` into `manager-tree.tsx`; the workspace tree pane keeps its explorer header and filter chips around it. No behaviour change for the workspace.
3. **Drive shell (`fm-drive`)**: rewrite `drive-shell.tsx` on the resizable tree | main | details panels with `ManagerTree` on the left and the existing drive header, bar and `ManagerList` on the right; narrow stacked mode with the back button. Delete `drive-nav.tsx` and `drive-ref-list.tsx` and their labels (`spaces`, `showNavigation`, `hideNavigation`, `noRecent`, `noStarred`); `newMenu` / `uploadMenu` stay.
4. **Registry**: `fm-react` gains `manager-tree.tsx`; `fm-drive` lists `drive-manager.tsx` and `drive-shell.tsx`.
5. **Demo / docs**: `?variant=drive` unchanged; README "Drive view" and architecture wording updated; changelog.

### Later (separate task, after this is reviewed)

bithk extension points as `DriveManager` props: space groups (personal / team / project / shared with me), quota, `columns` over `entry.extra` with column filters, detail-panel tabs rendered by the host (versions, shares, activity), "Move to…". The bithk driver adapter (`drive_entries` → `FmDriver`, path → id, one mount per space) lives in the bithk repository.

## Risks

- Folders-only tree: a folder that holds only files still shows an expand chevron that opens to nothing (the tree learns it has no subfolders only after listing it). Acceptable for a first version; a driver hint (`hasSubfolders`) could fix it later.
- Extracting `manager-tree.tsx` touches the workspace tree; the 85 workspace e2e tests guard it.
- `fm-drive` gets smaller (two files deleted); hosts that installed the first version re-add it.

## Scope

`fm-react`: `use-view-state.ts`, `use-listing-state.ts`, `use-changes.tsx`, `workspace-tree-pane.tsx`, new `manager-tree.tsx`, `labels.ts`. `fm-drive`: `drive-shell.tsx` (rewrite), delete `drive-nav.tsx`, `drive-ref-list.tsx`. `registry.json`, `tests/e2e/drive.spec.ts` (rewrite), README, `docs/architecture.md`, changelog.

## Verification

e2e `tests/e2e/drive.spec.ts` against `?variant=drive`:

- the tree shows spaces and folders but no files; clicking a tree folder lists it on the right and highlights it; switching spaces from the tree;
- double-click a file in the list → preview dialog, Next steps to the next file of the folder;
- Starred / Recent sections: a file opens the preview dialog;
- no Changes section and no change badges with a git repository and pending changes in the local root;
- grid by default and the list toggle; filter bar; New menu; batch bar delete + undo; Trash row opens the trash;
- narrow container: tree, then the list after choosing a folder, back to the tree.

Plus `bun run check`, the full e2e suite (workspace unchanged) and `registry:smoke`.

## Alternatives

- **Show files in the tree too** (clicking one opens the preview dialog): closer to the workspace, but the right side and the tree list the same files twice. Not chosen; can be an option later.
- **Keep the spaces navigation of the first version**: does not match the wanted interaction.

## Annotations

- Assumption: grid is the default view in the drive (user toggle, stored per variant); say if list should be the default.
- Added while implementing: in drive mode the listed folder itself is expanded in the tree (not only its ancestors), so new subfolders appear there at once, as in a file explorer.
- Follow-up after review: the folders-only chevron risk is fixed client-side. `FileTree.foldersOnly` marks a listed folder without subfolders as a leaf; unlisted folders keep the chevron until first opened (a driver `hasSubfolders` hint is still possible later).
