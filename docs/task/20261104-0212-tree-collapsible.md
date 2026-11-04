# 20261104-0212-tree-collapsible Folder tree on shadcn Collapsible

- **status**: completed
- **priority**: P2
- **owner**: claude/d4j0p0gu
- **createdAt**: 2026-11-04 02:12

## Description

Rebuild `registry/fm/react/file-tree.tsx` on shadcn `collapsible` + `button`: focusable rows and toggles (Tab / Enter / Space), and subfolders loaded across every listing page. Roles `tree` / `treeitem` (named by the label) / `group` stay; drag-and-drop, active highlight, read-only lock, trash row and "Manage drives" unchanged.

## ActiveForm

Rebuilding the folder tree

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-11-04: `fm-react` registryDependencies gain `collapsible`. Arrow-key tree navigation, remembered expansion and virtualization stay with ui-polish. Verified: lint, fm-web typecheck, 7 tree-related e2e.
- 2026-11-04: rows show folders and files (file click reveals it in the list); a row click navigates and toggles; keyboard: Up / Down / Home / End move between visible rows, Right expands or enters, Left collapses or goes to the parent, Enter / Space activate. Verified: 34 e2e.
- 2026-11-04: context menus on tree rows: folder / file rows reveal the entry and open the list entry menu; mount rows open the folder menu at the mount root; trash and group rows have none (`FmTreeTarget`, `onContextTarget`). Verified: 35 e2e.
