# 20261103-0508-sidebar-drives Sidebar drive visibility and grouping

- **status**: in_progress
- **priority**: P1
- **owner**: bkd-l2/cixdvil5
- **createdAt**: 2026-11-03 05:08

## Description

Host `sidebar={{ hidden, group }}` and a persisted per-user "Manage drives" toggle; group mounts by driver kind in the tree and the single-pane storage menu.

Design sketch and verification: [backlog proposals](../plan/20261103-0508-backlog-proposals.md). Write and get approval for a dedicated plan before implementing.

## ActiveForm

Adding sidebar drive visibility

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-11-03: requirement plan [20261103-1005-sidebar-drives](../plan/20261103-1005-sidebar-drives.md) (campaign [20261103-1005-p1-campaign](../plan/20261103-1005-p1-campaign.md)).
- 2026-11-03: implemented `sidebar={{ hidden, group }}`, the persisted "Manage drives" dialog (`${storageKey}:hidden`) and driver grouping in the tree and single-pane storage menu; pure helper `react/mount-visibility.ts` with unit tests, 3 new e2e flows (branch bkd/uloxm3iw).
