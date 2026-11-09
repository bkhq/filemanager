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
- [x] [**20261103-1005-p1-campaign P1 campaign: requirement docs and BKD dispatch**](20261103-1005-p1-campaign.md) `2026-11-03`
- [x] [**20261103-1005-change-events Change event hook**](20261103-1005-change-events.md) `2026-11-03`
- [x] [**20261103-1005-recursive-search Recursive search**](20261103-1005-recursive-search.md) `2026-11-03`
- [x] [**20261103-1005-quick-open Quick open**](20261103-1005-quick-open.md) `2026-11-03`
- [x] [**20261103-1005-pick-mode Pick mode (FilePicker)**](20261103-1005-pick-mode.md) `2026-11-03`
- [x] [**20261103-1005-sidebar-drives Sidebar drive visibility and grouping**](20261103-1005-sidebar-drives.md) `2026-11-03`
- [x] [**20261103-1005-publish-registry Publish the shadcn registry**](20261103-1005-publish-registry.md) `2026-11-03`
- [x] [**20261103-1005-cross-mount-copy Cross-mount copy and move**](20261103-1005-cross-mount-copy.md) `2026-11-03`
- [x] [**20261103-1005-resumable-uploads Large and resumable uploads**](20261103-1005-resumable-uploads.md) `2026-11-03`
- [x] [**20261103-1005-workers-r2 Cloudflare Workers app and R2 driver**](20261103-1005-workers-r2.md) `2026-11-03`
- [x] [**20261104-0200-resizable-panels Resizable panels**](20261104-0200-resizable-panels.md) `2026-11-04`
- [x] [**20261104-0337-tree-preview-layout Tree + preview layout**](20261104-0337-tree-preview-layout.md) `2026-11-04`
- [x] [**20261104-0558-explorer-parity Explorer parity campaign (bks / bkd review)**](20261104-0558-explorer-parity.md) `2026-11-04`
- [x] [**20261104-0558-editor Editor: save shortcut, wrap, conflicts, drafts, large files**](20261104-0558-editor.md) `2026-11-04`
- [x] [**20261104-0558-browser-shell Browser shell: copy path, folder menus, collapse all, remembered location, mobile**](20261104-0558-browser-shell.md) `2026-11-04`
- [x] [**20261104-0558-listing Listing: hidden files toggle and git-ignored entries**](20261104-0558-listing.md) `2026-11-04`
- [x] [**20261104-0558-previews Previews: binary sniff, PDF toolbar, Markdown plugin**](20261104-0558-previews.md) `2026-11-04`
- [x] [**20261104-0843-dropzone-streamdown Dropzone uploads, streamdown live preview, dependency catalog**](20261104-0843-dropzone-streamdown.md) `2026-11-04`
- [x] [**20261104-1110-ui-polish UI polish: marquee, virtual tree, drag out, paste upload, image keys, bundle, CI pin**](20261104-1110-ui-polish.md) `2026-11-04`
- [x] [**20261104-1110-trash-retention Trash retention and multi-select actions**](20261104-1110-trash-retention.md) `2026-11-04`
- [x] [**20261105-0210-list-filters List filters and host metadata (starred, recent)**](20261105-0210-list-filters.md) `2026-11-05`
- [x] [**20261105-0440-thumbnails Thumbnails and saving image edits**](20261105-0440-thumbnails.md) `2026-11-05`
- [x] [**20261105-0700-sheet-archive Sheet plugin upgrade and archive browsing**](20261105-0700-sheet-archive.md) `2026-11-05`
- [~] [**20261105-1030-file-drawer FileDrawer composition**](20261105-1030-file-drawer.md) `2026-11-05`
- [ ] [**20261105-1120-managed-store Managed store (generic, phase 1)**](20261105-1120-managed-store.md) `2026-11-05`
- [x] [**20261105-1300-change-message Change messages (commit notes) for writes**](20261105-1300-change-message.md) `2026-11-05`
- [x] [**20261105-1400-review-changes Changes / review, external edits, SVG preview**](20261105-1400-review-changes.md) `2026-11-05`
- [x] [**20261105-1830-adoption-fixes Upstream fixes from the bks adoption review**](20261105-1830-adoption-fixes.md) `2026-11-05`
- [x] [**20261106-0700-drive-variant Drive variant of FileManager (phases 1 and 2)**](20261106-0700-drive-variant.md) `2026-11-06`
- [~] [**20261106-0741-drive-host-extensions Drive host extensions (phase 3)**](20261106-0741-drive-host-extensions.md) `2026-11-06`
- [x] [**20261106-0815-fm-drive-item Optional fm-drive registry item**](20261106-0815-fm-drive-item.md) `2026-11-06`
- [x] [**20261106-0830-drive-tree-layout Drive view: folder tree + folder contents + preview dialog**](20261106-0830-drive-tree-layout.md) `2026-11-06`
- [x] [**20261106-0913-subfolder-hint Subfolder hints on folder entries**](20261106-0913-subfolder-hint.md) `2026-11-06`
- [x] [**20261106-0913-bithk-extension-points Drive extension points for bithk**](20261106-0913-bithk-extension-points.md) `2026-11-06`
- [x] [**20261106-0943-native-trash Driver-provided trash**](20261106-0943-native-trash.md) `2026-11-06`
- [x] [**20261107-0950-image-pan-zoom Image preview: real-size zoom and stage-wide pan**](20261107-0950-image-pan-zoom.md) `2026-11-07`
- [x] [**20261108-0546-image-viewer-extras Image preview: minimap, checkerboard, pixel size**](20261108-0546-image-viewer-extras.md) `2026-11-08`
- [x] [**20261109-0117-copy-absolute-path Absolute and relative copy path**](20261109-0117-copy-absolute-path.md) `2026-11-09`
