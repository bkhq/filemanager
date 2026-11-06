# 20261106-0830-drive-tree-layout Drive view: folder tree on the left, folder contents on the right

- **status**: completed
- **priority**: P1
- **owner**: claude/filemanager-20261106
- **createdAt**: 2026-11-06 08:30

## Description

Redesign `<DriveManager>` (`fm-drive`) for bithk with the current interaction: the same folder tree as the workspace on the left (spaces, Starred, Recent, Trash; folders only), the clicked folder's contents on the right, files open in the preview dialog. No Changes section or change decorations. Replaces the spaces navigation of the first drive version. bithk-specific extension points (space groups, quota, columns, detail tabs) are a later task.

Acceptance: plan [20261106-0830-drive-tree-layout](../plan/20261106-0830-drive-tree-layout.md) verification section.

## ActiveForm

Reworking the drive layout

## Dependencies

- **blocked by**: 20261106-0815-fm-drive-item
- **blocks**: (none)

## Notes

- 2026-11-06: design agreed in discussion (host bithk; tree + folder contents + preview dialog; no changes). Plan drafted for review; no code yet.

- complete: drive layout reworked; bithk extension points are the next task
