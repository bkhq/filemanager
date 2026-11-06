# 20261106-0741-drive-host-extensions Drive host extensions (phase 3)

- **status**: rejected
- **createdAt**: 2026-11-06 07:41
- **approvedAt**: (pending)
- **relatedTask**: 20261106-0741-drive-host-extensions

## Context

- The drive variant (plan `20261106-0700-drive-variant`) lists every visible mount as a space under one "Spaces" heading (`react/drive-nav.tsx`), grouped by driver only with `sidebar.group = "driver"`.
- Mounts are resolved per request (`createFmRouter({ mounts(c) })`), so a host can already give each user their personal, team, project and shared spaces as mounts; `GET /mounts` returns `FmMountInfo` (`core/schema.ts` `mountInfoSchema`: id, label, driver, caps, trash, thumbnails, changes, implicitFolders, uploadSessions, trashRetentionDays). Nothing describes how spaces group or how full they are.
- Entries now carry optional `extra` (host data); nothing renders it. `FileList` list rows show icon, name, change badge, optional parent, size, modified (`react/file-list.tsx` `ListRow`, `SortHeader`). `DetailsPanel` shows fixed rows.
- Filters (`react/filters.ts`) cover type and modified only; they are client-side over the loaded listing and persisted per mount.
- Moving across folders works by cut / paste or drag; there is no folder chooser. `runOps` already supports `dest` + `destMount` (cross-mount copy / move).

## Proposal

1. **Mount groups and quota** (server + schema):
   - `FmMount.group?: string` and `FmMount.quota?: { used: number; total?: number }` (bytes), copied into `FmMountInfo` (`group`, `quota`). Static per request, since mounts are resolved per request.
   - Drive navigation: spaces grouped by `group` in order of first appearance; ungrouped mounts stay under "Spaces"; `sidebar.group = "driver"` keeps working when no mount has a group. A "Shared with me" space is simply a host mount with `group: "Shared with me"` (documented, shown in the demo).
   - Quota of the current space at the bottom of the navigation: a bar and "1.2 MB of 10 GB used" (`total` absent → "1.2 MB used", no bar).
2. **Host columns** (`FileManagerProps.columns?: FmColumn[]`):
   ```ts
   interface FmColumn {
     id: string;                // key in entry.extra
     label: string;
     render?: (entry: FmEntry) => ReactNode; // default: the extra value as text, booleans as ✓ / empty
     width?: number;            // px, default 120
     filter?: boolean;          // offer the column's values in the filter menu
   }
   ```
   - List view: a cell and header per column between name and size (not sortable: sorting is server-side). Grid view unchanged. Both variants.
   - Details panel: one row per column.
   - Filters: `FmListFilters.extra?: Record<string, string[]>`; for `filter` columns the filter menu gets a submenu with the distinct values of the loaded folder; chips show "Owner: Ada"; `applyFilters` / `parseFilters` handle it.
3. **Move to… / Copy to…**:
   - `FolderPickerDialog` (`react/folder-picker.tsx`): space selector (writable visible mounts), breadcrumb, folder list (folders only, double-click to enter), "Move here" / "Copy here"; disabled inside a moved folder.
   - Runs the existing `runOps` with `dest` / `destMount` and `conflict: "rename"` (undo as today within one mount).
   - Entry context menu gains "Move to…" / "Copy to…" (both variants, gated by caps and `features.move` / `features.copy`); the drive batch bar gains both buttons.
4. **Demo**: `apps/fm-api` adds a "Shared with me" memory mount (`group`, read-only, entries with `extra.owner`), groups ("Personal", "Team") and a quota on the local mount; `apps/fm-web` passes an "Owner" column with `filter: true`.
5. **Labels** (en / zh): moveTo, copyTo, moveHere, copyHere, quota strings, column filter chip.

## Risks

- Columns change the list row layout of the workspace variant too; without `columns` nothing changes (e2e guard).
- Distinct-value filters only see the loaded pages; acceptable for folder-sized listings, documented.
- The folder picker adds listings of other mounts; it reuses `useListing` and its cache.

## Scope

`server/router.ts` (+ test), `core/schema.ts`, `react/drive-nav.tsx`, `react/file-list.tsx`, `react/details-panel.tsx`, `react/filters.ts` (+ test), `react/filter-menu.tsx`, new `react/folder-picker.tsx`, `react/manager-menus.tsx`, `react/drive-shell.tsx`, `react/manager-overlays.tsx` (dialog), `react/use-view-state.ts` (dialog state), `react/labels.ts`, `react/file-manager.tsx` (props), `apps/fm-api`, `apps/fm-web`, `registry.json`, README, architecture, changelog, `tests/e2e/drive.spec.ts`.

## Verification

- Unit: `applyFilters` / `parseFilters` with extra filters; router test for `group` / `quota` in `GET /mounts`.
- e2e (drive): groups in the navigation, quota text on the local space, Owner column and filtering by owner on the shared space, Move to… into another folder (and undo), Copy to… into another space.
- `bun run check`, full e2e, `registry:smoke`.

## Alternatives

- **Dedicated `shared` / `team` mount kinds with icons**: more UI, but every host maps its own notion; a free `group` label covers it.
- **Server-side column sort / filter**: needs driver support for extra fields; postponed until a driver (managed store) indexes them.

## Annotations

- 2026-11-06: postponed. Hosts that only browse and edit files should not carry drive code; the drive variant moves to an optional `fm-drive` registry item (plan 20261106-0815-fm-drive-item) and is redesigned before any of this is built.
