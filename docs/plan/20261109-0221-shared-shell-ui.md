# 20261109-0221-shared-shell-ui Share the common UI of DriveShell and WorkspaceShell

- **status**: completed
- **createdAt**: 2026-11-09 02:21
- **approvedAt**: 2026-11-09 03:30
- **relatedTask**: 20261109-0221-shared-shell-ui

## Context

`react/drive-shell.tsx` (registry item `fm-drive`) and `react/workspace-shell.tsx` (`fm-react`) copy about 155 lines of UI.

## Proposal

New `react/shell-parts.tsx` in `fm-react`, taking the `fm` controller like `ManagerList`: `ShellDropSection`, `ShellNotices`, `ShellTrash`, `ShellDetails`, `ViewToggle`, `EmptyTrashButton`, `SortMenuItems`, `UploadMenuItems`, `ShellBreadcrumb` (`root`, `className`), `ShellSearch` (`width`, `children`) and `SelectionActions` (`actions`).

Layout stays in each shell. Props and behaviour do not change; the workspace selection toolbar still has no host actions.

## Risks

Markup differences between the shells could be lost; each difference is a prop.

## Scope

`registry/fm/react/shell-parts.tsx`, `drive-shell.tsx`, `workspace-shell.tsx`, `registry.json`, changelog.

## Verification

`bun run check`, full e2e, `registry:smoke`.

## Alternatives

Merging the shells into one configurable component: their layouts differ too much.
