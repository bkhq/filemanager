# 20261109-0117-copy-absolute-path Absolute and relative copy path

- **status**: completed
- **createdAt**: 2026-11-09 01:17
- **approvedAt**: 2026-11-09 01:17
- **relatedTask**: 20261109-0117-copy-absolute-path

## Context

`react/manager-menus.tsx` and `react/details-panel.tsx` copy `entry.path`, relative to the mount with a leading slash. The client does not know the server directory behind a mount.

## Proposal

- `FmMount.absoluteRoot?: string`, returned by `GET /mounts`. Set by the host, never derived from the local driver, since the server's directory layout is sensitive.
- "Copy path": root + entry path, shown only when the mount has `absoluteRoot`.
- "Copy relative path" (new): the entry path without the leading slash, always shown.
- Details panel: absolute when known, else relative. Demo: Local disk sets it.

## Risks

Public additions only. A host that does not set the field loses the misleading "Copy path" and keeps "Copy relative path".

## Scope

`core/schema.ts`, `core/path.ts`, `server/router.ts`, `react/manager-menus.tsx`, `react/details-panel.tsx`, both shells, `react/labels.ts`, `apps/fm-api`, tests, README, changelog.

## Verification

Unit tests for the path helpers, a router test for the field, the copy e2e, `bun run check`.

## Annotations

(none yet)
