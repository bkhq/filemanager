# 20261106-0959-demo-native-trash Demo: a database-style space with its own trash

- **status**: completed
- **priority**: P2
- **owner**: claude/filemanager-20261106
- **createdAt**: 2026-11-06 09:59

## Description

Show the driver-provided trash in the drive demo: a "Team drive" space dressed as a database-backed drive (stable ids across renames, owners kept by id, its own trash with a 14-day expiry), and e2e for both. Inline proposal approved in discussion (standard tier, no plan file).

## ActiveForm

Adding the team drive demo

## Dependencies

- **blocked by**: 20261106-0943-native-trash
- **blocks**: (none)

## Notes

- Found while building it: `TrashView` showed the Expires column only with the mount's `retentionDays`, so a driver's own `expiresAt` was invisible; it now shows whenever an item carries one.
- Verified: `bun run check` (350 pass), 103 Playwright e2e (18 drive), `registry:smoke`.

- complete: team drive demo and expiry column fix
