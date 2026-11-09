# Filemanager - Task List

> Updated: 2026-11-03

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/<timestamp>-<feature-slug>.md`.

### Format

- [ ] [**20260907-1428-add-endpoint Add endpoint**](20260907-1428-add-endpoint.md) `P1`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Pending |
| `[-]`  | In progress |
| `[x]`  | Completed |
| `[~]`  | Closed / Won't do |
| `[d]`  | Deleted detail file; index entry retained |

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- Only update the checkbox marker; never delete the line or change its other content. If the detail file is deleted, mark the entry `[d]`.
- Record change history and deletion reasons in `docs/changelog.md`; update affected dependency and plan references.
- New tasks append to the end.
- See each `<timestamp>-<feature-slug>.md` for full details, except `[d]` entries whose files have been deleted; consult `docs/changelog.md` for their history.

---

## Tasks

- [x] [**20261102-1157-p0-foundation P0 foundation: registry scaffold, core, server, local provider, React UI, demo**](20261102-1157-p0-foundation.md) `P1`
- [x] [**20261102-1908-drive-parity Drive-parity batch: trash, search, upload conflicts, undo, details, previews**](20261102-1908-drive-parity.md) `P1`
- [x] [**20261103-0508-cross-mount-copy Cross-mount copy and move (content copy between drivers)**](20261103-0508-cross-mount-copy.md) `P1`
- [x] [**20261103-0508-sidebar-drives Sidebar drive visibility and grouping**](20261103-0508-sidebar-drives.md) `P1`
- [x] [**20261103-0508-publish-registry Publish the shadcn registry**](20261103-0508-publish-registry.md) `P1`
- [x] [**20261103-0508-resumable-uploads Large and resumable uploads**](20261103-0508-resumable-uploads.md) `P1`
- [x] [**20261103-0508-workers-r2 Cloudflare Workers demo and R2 driver**](20261103-0508-workers-r2.md) `P1`
- [x] [**20261103-0508-thumbnails Thumbnails and saving image edits**](20261103-0508-thumbnails.md) `P2`
- [x] [**20261103-0508-trash-retention Trash retention and bulk actions**](20261103-0508-trash-retention.md) `P2`
- [x] [**20261103-0508-recursive-search Recursive search**](20261103-0508-recursive-search.md) `P2`
- [-] [**20261103-0508-plugin-followups Plugin follow-ups (sheet, markdown, archive, office)**](20261103-0508-plugin-followups.md) `P2`
- [x] [**20261103-0508-ui-polish UI polish and bundle size**](20261103-0508-ui-polish.md) `P2`
- [x] [**20261103-0508-bkd-pilot bkd pilot adoption**](20261103-0508-bkd-pilot.md) `P3`
- [ ] [**20261103-0508-managed-store Managed store and bithk adapter**](20261103-0508-managed-store.md) `P3`
- [x] [**20261103-1530-change-events Change event hook for audit and host refresh**](20261103-1530-change-events.md) `P1`
- [x] [**20261103-1530-pick-mode Pick mode (FilePicker) for attachments and imports**](20261103-1530-pick-mode.md) `P1`
- [x] [**20261103-1530-quick-open Quick open (fuzzy file search)**](20261103-1530-quick-open.md) `P1`
- [x] [**20261103-1530-list-filters List filters and host metadata (starred, recent)**](20261103-1530-list-filters.md) `P2`
- [x] [**20261103-0846-naming-conventions Naming conventions for shipped code**](20261103-0846-naming-conventions.md) `P1`
- [x] [**20261103-0939-no-deprecated-apis Remove deprecated API usage and lint against it**](20261103-0939-no-deprecated-apis.md) `P1`
- [x] [**20261103-0948-rename-dev-apps Rename demo apps to fm-api / fm-web**](20261103-0948-rename-dev-apps.md) `P1`
- [x] [**20261104-0200-resizable-panels Resizable panels**](20261104-0200-resizable-panels.md) `P2`
- [x] [**20261104-0212-tree-collapsible Folder tree on shadcn Collapsible**](20261104-0212-tree-collapsible.md) `P2`
- [x] [**20261104-0337-tree-preview-layout Tree + preview layout**](20261104-0337-tree-preview-layout.md) `P2`
- [x] [**20261104-0558-editor Editor: save shortcut, wrap, conflicts, drafts, large files**](20261104-0558-editor.md) `P2`
- [x] [**20261104-0558-browser-shell Browser shell: copy path, folder menus, collapse all, remembered location, mobile**](20261104-0558-browser-shell.md) `P2`
- [x] [**20261104-0558-listing Listing: hidden files toggle and git-ignored entries**](20261104-0558-listing.md) `P2`
- [x] [**20261104-0558-previews Previews: binary sniff, PDF toolbar, Markdown plugin**](20261104-0558-previews.md) `P2`
- [x] [**20261104-0843-dropzone-streamdown Dropzone uploads, streamdown live preview, dependency catalog**](20261104-0843-dropzone-streamdown.md) `P2`
- [x] [**20261106-0700-drive-variant Drive variant of FileManager**](20261106-0700-drive-variant.md) `P1`
- [~] [**20261106-0741-drive-host-extensions Drive host extensions: groups, quota, columns, Move to**](20261106-0741-drive-host-extensions.md) `P1`
- [x] [**20261106-0815-fm-drive-item Move the drive variant into an optional fm-drive item**](20261106-0815-fm-drive-item.md) `P1`
- [x] [**20261106-0830-drive-tree-layout Drive view: folder tree on the left, folder contents on the right**](20261106-0830-drive-tree-layout.md) `P1`
- [x] [**20261106-0913-subfolder-hint Folder entries tell whether they hold subfolders**](20261106-0913-subfolder-hint.md) `P2`
- [x] [**20261106-0913-bithk-extension-points Drive extension points for bithk**](20261106-0913-bithk-extension-points.md) `P1`
- [x] [**20261106-0943-native-trash Drivers may bring their own trash**](20261106-0943-native-trash.md) `P1`
- [x] [**20261106-0959-demo-native-trash Demo: a database-style space with its own trash**](20261106-0959-demo-native-trash.md) `P2`
- [x] [**20261107-0950-image-pan-zoom Image preview: zoom to real size and pan over the whole stage**](20261107-0950-image-pan-zoom.md) `P2`
- [x] [**20261108-0342-one-rotate-button Image preview: one rotate button**](20261108-0342-one-rotate-button.md) `P3`
- [x] [**20261108-0546-image-viewer-extras Image preview: minimap, transparency checkerboard, pixel size**](20261108-0546-image-viewer-extras.md) `P2`
- [x] [**20261109-0117-copy-absolute-path Copy path gives the real absolute path**](20261109-0117-copy-absolute-path.md) `P1`
- [x] [**20261109-0125-dialog-fullscreen Preview dialogs can go full screen**](20261109-0125-dialog-fullscreen.md) `P1`
- [x] [**20261109-0211-audit-cleanup Remove redundant code and stale docs found by the audit**](20261109-0211-audit-cleanup.md) `P2`
- [x] [**20261109-0221-shared-shell-ui Share the common UI of DriveShell and WorkspaceShell**](20261109-0221-shared-shell-ui.md) `P2`
