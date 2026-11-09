# 20261109-0117-copy-absolute-path Copy path gives the real absolute path

- **status**: completed
- **priority**: P1
- **owner**: claude/filemanager-20261109
- **createdAt**: 2026-11-09 01:17

## Description

"Copy path" copied the mount-relative `entry.path`, which looks absolute but is not. Hosts may declare `FmMount.absoluteRoot`; "Copy path" then gives the real path, and a new "Copy relative path" gives the path without the leading slash.

Acceptance: plan [20261109-0117-copy-absolute-path](../plan/20261109-0117-copy-absolute-path.md) verification section.

## ActiveForm

Fixing copy path

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Approved in discussion (`proceed`). bkd has to set `absoluteRoot` on its project and worktree mounts after upgrading.

- complete: absolute and relative copy path; full e2e left to the user's dev check
