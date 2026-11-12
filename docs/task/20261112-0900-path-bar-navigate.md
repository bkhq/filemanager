# 20261112-0900-path-bar-navigate Path bar steps navigate; separators open the pickers

- **status**: completed
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-11-12 09:00

## Description

Every step of `PathBar` opened a picker of its siblings, so going back to a parent folder took the picker of the step before it, or repeated "Up".

- A folder step that is not the last one goes to that folder (`onNavigate`, new required prop).
- The separator after a folder is a button (`labels.folderContents`) that opens the picker of that folder's entries.
- The last step (current folder or open file) keeps its sibling picker; the `root` slot (storage menu) is unchanged.
- Explorer (split) layout: the step closes the open file (guarded when the editor is dirty) and the main pane lists the folder (`ManagerList`) under the unchanged explorer header — path bar only, folder actions stay in the tree pane — until a file opens again (`folderList` in `use-listing-state.ts`). Tree clicks are unchanged: they keep the open file.

## ActiveForm

Making path bar steps navigate

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Approved in chat, no separate plan. e2e: `fm.spec.ts` "a folder step of the path bar lists that folder in the pane", `drive.spec.ts` "the last path step opens a picker; earlier steps navigate".
