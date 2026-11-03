# 20261103-1005-sidebar-drives Sidebar drive visibility and grouping

- **status**: implementing
- **createdAt**: 2026-11-03 10:05
- **approvedAt**: 2026-11-03 10:12
- **relatedTask**: 20261103-0508-sidebar-drives

## Context

Mounts come from `useMounts` (`registry/fm/react/file-manager.tsx:164`); the tree renders one node per mount (`react/file-tree.tsx:86-112`); the single-pane storage menu is at `file-manager.tsx:556-575`. Preferences persist under `storageKey` via `useStoredChoice` (`file-manager.tsx:130-142`). `FmMountInfo` (`core/schema.ts`) carries `driver` (kind) and `label`.

## Proposal

- Prop `sidebar?: { hidden?: string[]; group?: "none" | "driver" }` on `FileManager`.
- `hidden` removes mounts from the tree and the storage menu; they stay reachable via `initialMount`.
- `group: "driver"`: one collapsible section per driver kind (Local, S3, Memory, other kinds by name), order of first appearance.
- "Manage drives" entry at the bottom of the tree and in the storage menu: a dialog with a checkbox per mount, persisted in `localStorage` at `${storageKey}:hidden`. Host `hidden` wins and those mounts are not listed in the dialog. The current mount can never be hidden from itself.
- Visibility merge as a pure function (`visibleMounts(all, hostHidden, userHidden, current)`) with unit tests.
- Labels en / zh.

## Acceptance

- Unit test for the visibility merge.
- e2e: hide a mount, reload, still hidden; group by driver shows section headers; the single-pane menu respects the same visibility.
- `bun run check` and `bun run test:e2e` pass.

## Risks

- None beyond UI churn in `file-manager.tsx` (shared with pick mode in the same workstream).

## Scope

`react/file-manager.tsx`, `react/file-tree.tsx`, `react/dialogs.tsx` (manage dialog), `react/labels.ts`, new pure helper + test, `tests/e2e/fm.spec.ts`.

## Alternatives

- Server-side hiding only (`mounts(c)`): already possible, but not user-controlled.
