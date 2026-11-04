# 20261104-0337-tree-preview-layout Tree + preview layout

- **status**: completed
- **createdAt**: 2026-11-04 03:37
- **approvedAt**: 2026-11-04 03:37
- **relatedTask**: 20261104-0337-tree-preview-layout

## Context

The split layout shows the folder tree (now listing folders and files, with context menus and keyboard navigation) next to the file list, so the list duplicates the tree. Previews open in `PreviewDialog` (`react/preview-dialog.tsx`), which wraps a previewer found by `findPreviewer` with a header, previous / next and an unsaved-edit guard.

## Proposal

- Split layout (tree visible, not narrow): right side = preview area; single / narrow layouts keep the list; `FilePicker` (single) unaffected.
- Right side content: file selected in the tree -> inline preview (header with name, download, rename, delete, details); folder or mount -> empty state with folder name, item count, size and "select a file", accepting file drops for upload; trash -> the trash view as today.
- Toolbar above the tree: new folder, new file, upload, quick open, refresh. Entry actions via the tree context menu and the preview header, targeting the tree selection.
- Not in this mode: multi-select / bulk actions, sort, grid view, folder filter search (hide the tree to get the list).
- Unsaved edits: switching files asks before discarding (as in the dialog).
- Extract the previewer body of `PreviewDialog` into `PreviewPane`, used by the dialog and the inline area.

## Risks

- Large change to `file-manager.tsx`; e2e that browse with the tree and act on the list need the single layout or tree interactions.

## Scope

`react/file-manager.tsx`, `react/preview-dialog.tsx` (+ new pane), `react/labels.ts`, `registry.json` (new file), `tests/e2e/fm.spec.ts`, README, changelog.

## Alternatives

- Remove the list entirely: loses multi-select / bulk actions and breaks the picker.
- Folder selected -> show its contents list on the right: keeps duplication the user wants gone.

## Annotations

2026-11-04: user chose the recommended option ("按照推荐的来, go").

## As built

- \`explorer = split && !pick\`: with the tree shown, the right side previews instead of listing; single / narrow / picker keep the list.
- No new selection state: the previewed file is the single selected file of the current folder (tree file click = \`reveal\`), so keyboard shortcuts, context menus and details keep working. Folder or mount selected -> empty state (name, item count, hint, drop-to-upload) with the folder context menu.
- Right header in explorer: up, breadcrumb, previewer actions (portal), download, rename, delete, sidebar, details; the folder search box and list toolbar are hidden. Tree toolbar: new folder, new file, upload, paste, quick open, refresh.
- "Open" and quick open on a file select it instead of opening the dialog.
- Unsaved edits: \`go\` and \`reveal\` (and list key navigation) run through \`guard\`; a ref tracks dirty state so the confirmed navigation does not re-prompt. \`PreviewBody\` / \`DiscardChangesDialog\` extracted to \`react/preview-pane.tsx\` and shared with \`PreviewDialog\`.
- Tree rows (folders, files) are draggable; drops carry the source mount (\`application/x-fm-mount\`), so moving / copying by drag works without the list.
- e2e default to the single layout (\`beforeEach\`); tree tests opt into split. New: inline preview, unsaved-edit guard, tree drag. Verified: 37 Playwright e2e.
