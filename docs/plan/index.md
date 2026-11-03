# Filemanager - Plan Index

> Updated: 2026-11-02

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/<timestamp>-<feature-slug>.md`.

### Format

- [ ] [**20260907-1440-add-endpoint Add endpoint**](20260907-1440-add-endpoint.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Draft / Pending review |
| `[-]`  | Approved / Implementing |
| `[x]`  | Completed |
| `[~]`  | Rejected / Abandoned |
| `[d]`  | Deleted detail file; index entry retained |

### Rules

- Only update the checkbox marker; never delete the line or change its other content. If the detail file is deleted, mark the entry `[d]`.
- Record change history and deletion reasons in `docs/changelog.md`; update affected task and plan references.
- New plans append to the end.
- See each `<timestamp>-<feature-slug>.md` for full details, except `[d]` entries whose files have been deleted; consult `docs/changelog.md` for their history.

---

## Plans

- [x] [**20261102-1157-p0-foundation P0 foundation**](20261102-1157-p0-foundation.md) `2026-11-02`
- [x] [**20261102-1908-drive-parity Drive-parity batch**](20261102-1908-drive-parity.md) `2026-11-02`
- [ ] [**20261103-0508-backlog-proposals Open work after the Drive-parity batch**](20261103-0508-backlog-proposals.md) `2026-11-03`
- [x] [**20261103-0846-naming-conventions Naming conventions for shipped code**](20261103-0846-naming-conventions.md) `2026-11-03`
- [x] [**20261103-0939-no-deprecated-apis Remove deprecated API usage and lint against it**](20261103-0939-no-deprecated-apis.md) `2026-11-03`
- [x] [**20261103-0948-rename-dev-apps Rename demo apps to fm-api / fm-web**](20261103-0948-rename-dev-apps.md) `2026-11-03`
- [-] [**20261103-1005-p1-campaign P1 campaign: requirement docs and BKD dispatch**](20261103-1005-p1-campaign.md) `2026-11-03`
- [x] [**20261103-1005-change-events Change event hook**](20261103-1005-change-events.md) `2026-11-03`
- [-] [**20261103-1005-recursive-search Recursive search**](20261103-1005-recursive-search.md) `2026-11-03`
- [-] [**20261103-1005-quick-open Quick open**](20261103-1005-quick-open.md) `2026-11-03`
- [x] [**20261103-1005-pick-mode Pick mode (FilePicker)**](20261103-1005-pick-mode.md) `2026-11-03`
- [x] [**20261103-1005-sidebar-drives Sidebar drive visibility and grouping**](20261103-1005-sidebar-drives.md) `2026-11-03`
- [-] [**20261103-1005-publish-registry Publish the shadcn registry**](20261103-1005-publish-registry.md) `2026-11-03`
- [ ] [**20261103-1005-cross-mount-copy Cross-mount copy and move**](20261103-1005-cross-mount-copy.md) `2026-11-03`
- [ ] [**20261103-1005-resumable-uploads Large and resumable uploads**](20261103-1005-resumable-uploads.md) `2026-11-03`
- [ ] [**20261103-1005-workers-r2 Cloudflare Workers app and R2 driver**](20261103-1005-workers-r2.md) `2026-11-03`
