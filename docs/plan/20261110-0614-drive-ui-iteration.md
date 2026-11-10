# 20261110-0614-drive-ui-iteration Drive and workspace UI iteration

- **status**: completed
- **createdAt**: 2026-11-10 06:14
- **approvedAt**: 2026-11-09 18:16
- **relatedTask**: 20261110-0614-drive-ui-iteration

Merges the plans 20261109-1815-drive-ui-refresh, 20261110-0235-workspace-roomy-single, 20261110-0325-unify-toolbar-path, 20261110-0540-resizable-preview-splits and 20261110-0620-sheet-column-resize, and the plan-less tasks 20261110-0253-more-button-stays, 20261110-0420-wheel-zoom-step and 20261110-0510-demo-view-switch. Every section describes the shipped state. Each item was approved by the user before it was built.

## Context

- `DriveShell` (`fm-drive`) and `WorkspaceShell` (`fm-react`) share `ManagerList` -> `FileList`. `FileList` geometry is fixed for the virtualizer and marquee (`ROW` 36, `CELL_W` 120, `CELL_H` 132).
- The workspace split layout is the explorer (tree + preview, `use-listing-state.ts:120`) and shows no listing; the listing appears in the single layout and in pick mode.
- Entry menus are built from `ContextMenuItem` (`manager-menus.tsx`) and cannot render inside a `DropdownMenu`.
- Bottom overlays: undo snackbar centred on the root (`manager-overlays.tsx`), upload panel bottom right (`upload-panel.tsx`).
- The explorer's `PathBar` opens a picker per step; the list views had plain `ShellBreadcrumb` links.
- react-zoom-pan-pinch with `smooth` adds `step * |deltaY|` to the scale, so one mouse notch (deltaY ~100) added 8 and hit the maximum.
- Only the shells used `ResizablePanelGroup`; the archive preview (`w-1/2`) and the Markdown side-by-side preview (two `flex-1`) were fixed, and spreadsheet columns were a fixed 160px.

## Proposal

### 1. Drive look (`roomy`)

- `FileList` prop `roomy`, passed through `ManagerList`: rows 40px, 24px list thumbnails (only when the mount has thumbnails, images under 20 MB, icon on error, never the full image), a more button on rows and tiles, 160px tiles with a square muted face (`ROOMY_CELL_H` 200), list columns by container width (size from `@md`, modified from `@2xl`). Without `roomy` the output is unchanged.
- The more button dispatches `contextmenu` at its own position, so it reuses the entry menu and its selection rule. It shows on hover, focus and coarse pointers, and stays on selected entries while the entry menu is open (`ManagerList` tracks `onOpenChange`).
- `DriveShell` always passes `roomy`. `WorkspaceShell` passes it outside pick mode (`!split && !pick`); pick mode keeps the dense list.

### 2. Toolbars and the floating selection bar

- Drive toolbar: first row back, up, path, New, Upload (Empty trash in the trash); second row filter, sort, chips, then search, view, details on the right. It no longer changes with the selection.
- `FloatingSelectionBar` (`shell-parts.tsx`), used by both shells with `roomy`: bottom centre of the listing, raised above the undo notice, same `role=toolbar` and "N selected" name. The list gets bottom padding while a selection exists. Delete in `SelectionActions` is red.
- Workspace sort trigger is always an icon button.

### 3. Path bar in the list views

- `PathBar`: optional `onOpenFolder` (a folder in a picker navigates and closes it), `root` replacing the mount step, `className`. `root` and the mount step are keyed apart.
- `ShellBreadcrumb` renders `PathBar` with `fm.open` outside the trash; the trash keeps plain crumbs. The workspace passes its storage switcher as `root`.

### 4. Storage menu

- The separator sits before the tree sections (Changes, Starred, Recent), not after them, so no two separators touch.
- Muted section icons take the menu text colour there; the tree and the amber star are unchanged.

### 5. Image wheel zoom

- The library wheel is off (`wheel.disabled`, no `smooth`). `MediaStage` listens to `wheel` itself and zooms around the pointer by `wheelFactor` (`transform.ts`): lines (16px) and pages become pixels, the delta is capped at one notch (100px), the factor is `1.2 ** (-px / 100)`. Buttons, keys, double-click, pinch and the [1, max] range are unchanged.

### 6. Resizable splits and columns

- Archive preview: tree and entry panels (min 20%) with a handle, saved under `fm-archive:panels`.
- Markdown preview: the group is always rendered and the editor panel always mounted; the preview panel exists outside source mode, the handle only in side mode; saved under `fm-markdown:panels`. The hidden editor panel needs a `data-fm-hidden` attribute and an `!important` rule on the group.
- Spreadsheet preview: a `separator` on each column header edge (drag, or ArrowLeft / ArrowRight by 16px), widths 40..1000px per sheet for the open preview only.
- New labels `resizePanes` and `resizeColumn(name)` (en / zh).

### 7. Demo view switch

- `apps/fm-web/src/app.tsx`: a View menu (Workspace / Drive) next to the language menu; it rewrites `?variant` and reloads.

## Risks

- A selected row at the very bottom of the screen sits under the centred bar, which can swallow the second press of a double click.
- At medium widths the upload panel (bottom right) can cover the right end of the bar.
- Trackpad pinch shares the wheel factor and may feel slow.
- Going to an ancestor folder takes the picker (or Up) instead of one click on a crumb.
- Two labels were added to `FmLabels` (additive). The preview layout storage keys are shared by every manager on the page.

## Scope

`registry/fm/react/{file-list,manager-list,drive-shell,workspace-shell,shell-parts,path-bar,media-stage,transform,labels}.tsx|ts`, `registry/fm/plugins/{archive-view,markdown-view,sheet-view}.tsx`, `apps/fm-web/src/app.tsx`, `tests/e2e/{drive,fm,image}.spec.ts`, `registry/fm/react/transform.test.ts`, docs.

## Verification

Each item went RED -> GREEN in e2e (and `transform.test.ts` for the wheel factor). Final state: `bun run check` (357 unit tests), 122 e2e, `registry:smoke`. `fm.spec.ts` runs at a 1200px tall viewport, and the column test uses `/0-sheet-cols-e2e`, because the serial suite fills the root and folders near the bottom fall under the selection bar or out of the virtual list.

## Alternatives

- Render entry menus as dropdown items for the more button: a real anchored dropdown, but a wider change in `manager-menus.tsx`.
- Bar at the bottom left: clear of the upload panel, but the user preferred it centred.
- Collapse Markdown panels imperatively: more code and a first-paint flash.
- Double-click a column edge to fit its content: needs text measuring; not done.

## Annotations

Open follow-ups stay separate: 20261110-0300-flaky-minimap-e2e, 20261110-0621-preview-dialog-resize.
