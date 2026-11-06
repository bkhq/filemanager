# 20261106-0913-bithk-extension-points Drive extension points for bithk

- **status**: completed
- **createdAt**: 2026-11-06 09:13
- **approvedAt**: 2026-11-06 09:20
- **relatedTask**: 20261106-0913-bithk-extension-points

## Context

- `<DriveManager>` (`fm-drive`) shows the folder tree (spaces = mounts, Starred, Recent, Trash), the chosen folder as grid / list, a batch bar and the preview dialog (plan 20261106-0830-drive-tree-layout). It shares `useFileManager` and the components of `fm-react`.
- bithk's drive (from `docs/architecture.md` §1 and the gap table in `20261103-0508-backlog-proposals`): spaces per user / team / project, shares ("shared with me"), quota, owner and source columns with filters, versions with pin, share links, activity. Its backend keeps owning these; the file manager renders them. The bithk driver adapter (`drive_entries` → `FmDriver`, path → id, one mount per space) lives in the bithk repository.
- Mounts are resolved per request (`createFmRouter({ mounts(c) })`), so the server already knows each user's spaces. `GET /mounts` returns `FmMountInfo` without grouping or usage. `FileTree` groups mounts only by driver (`group: "driver"`).
- Entries carry optional `id` and `extra` (host data); nothing renders `extra`. `FileList` list rows: icon, name, change badge, optional parent, size, modified. `DetailsPanel` (`react/details-panel.tsx`) shows fixed rows for one entry.
- Filters (`react/filters.ts`) cover type and modified, client-side over the loaded listing.
- Host actions (`FmFileAction`) already reach the context menu and the drive batch bar; moving to another folder works by cut / paste or drag only. `runOps` supports `dest` + `destMount`.
- The rejected plan 20261106-0741-drive-host-extensions proposed most of this for the earlier spaces navigation; this plan targets the tree layout and keeps drive-only parts in `fm-drive`.

## Proposal

### 1. Space groups and quota (server fields, shown by the drive)

- `FmMount.group?: string` and `FmMount.quota?: { used: number; total?: number }` (bytes), copied into `FmMountInfo`. Static per request, like the rest of the mount. Hosts decide the groups ("Personal", "Team: Sales", "Shared with me").
- Drive tree: mounts grouped under collapsible group rows in order of first appearance when any mount has a `group`; ungrouped mounts stay at the top level. `FileTree` gains `group: "space"` next to `"driver"`; the workspace keeps `sidebar.group`.
- Drive quota: under the tree, for the current space: a bar and "1.2 MB of 10 GB used" (no `total` → "1.2 MB used", no bar).
- "Shared with me" needs nothing special: the host serves it as a mount in its own group (read-only or not, per its own rules).

### 2. Host columns (`fm-react`, optional)

```ts
interface FmColumn {
  id: string;                               // key in entry.extra
  label: string;
  render?: (entry: FmEntry) => ReactNode;   // default: the value as text; true → ✓, false / null → empty
  width?: number;                           // px, default 120
  filter?: boolean;                         // offer the column's values in the filter menu
}
```

- `columns` prop on `FileManager` and `DriveManager`. List view: one cell and header per column between name and size (not sortable: sorting is server-side). Grid unchanged. Details panel: one row per column.
- Filters: `FmListFilters.extra?: Record<string, string[]>`; a `filter` column adds a submenu with the distinct values of the loaded folder; chips read "Owner: Ada"; `applyFilters` / `parseFilters` handle it.

### 3. Host detail tabs (`fm-react`, optional)

```ts
interface FmDetailTab {
  id: string;
  label: string;
  /** Rendered for the entry shown in the details panel; hosts call their own API (e.g. by entry.id). */
  render: (entry: FmEntry, ctx: { client: FmClient; refresh: () => Promise<void> }) => ReactNode;
  when?: (entry: FmEntry) => boolean;
}
```

- `detailTabs` prop on both managers. `DetailsPanel` shows tabs "Details" + host tabs when any apply; without tabs it is unchanged. bithk renders versions (with pin), shares and activity here.

### 4. Move to… / Copy to… (`fm-drive`)

- `FolderPickerDialog` (`react/drive-folder-picker.tsx`): space selector (writable visible mounts), breadcrumb, folders of the current location (double-click to enter), "Move here" / "Copy here", disabled inside a moved folder.
- `DriveManager` adds two built-in actions (context menu and batch bar) that open the dialog; it runs `runOps` with `dest` / `destMount`, `conflict: "rename"` (undo within one mount as today).

### 5. Demo and docs

- `apps/fm-api`: groups ("Personal" for Local disk and Scratch, "Shared with me" for a new read-only memory mount whose entries carry `extra.owner`), a quota on Local disk.
- `apps/fm-web` (drive): an "Owner" column with `filter: true`, a sample "Activity" detail tab.
- Labels (en / zh), README "Drive view" section, architecture, changelog.

## Risks

- `columns` / `detailTabs` change list rows and the details panel of the workspace too, but only when passed; workspace e2e guard the default.
- Column filters only see loaded pages; documented.
- Group rows add a level to the tree for hosts that set `group`; keys stay stable (`group:<label>`).

## Scope

Server: `server/router.ts` (+ test), `core/schema.ts`. `fm-react`: `file-tree.tsx`, `manager-tree.tsx`, `file-list.tsx`, `details-panel.tsx`, `filters.ts` (+ test), `filter-menu.tsx`, `file-manager.tsx` (props), `manager-list.tsx`, `labels.ts`. `fm-drive`: `drive-manager.tsx`, `drive-shell.tsx`, new `drive-folder-picker.tsx`, new `drive-quota.tsx`. `registry.json`, `apps/fm-api`, `apps/fm-web`, `tests/e2e/drive.spec.ts`, README, architecture, changelog.

## Verification

- Unit: `applyFilters` / `parseFilters` with extra filters; router test for `group` / `quota` in `GET /mounts`.
- e2e (drive): group rows in the tree with their spaces; quota text for Local disk; Owner column and filtering by owner in "Shared with me"; a host detail tab renders for the selected entry; Move to… into another folder with undo; Copy to… into another space.
- e2e (workspace): unchanged without `columns` / `detailTabs`.
- `bun run check`, full e2e, `registry:smoke`.

## Alternatives

- **Groups and quota as `DriveManager` props** instead of mount fields: no server change, but the host client then has to know which mount belongs to which space and its usage, which the server already resolves per request. Not chosen.
- **Versions / shares built into the file manager** (managed store): bithk already has them; deferred with the managed store.
- **Server-side column sort / filter**: needs drivers that index `extra`; later, with a driver that can.

## Annotations

- The quota lives in `drive-shell.tsx` (a few lines) instead of a separate `drive-quota.tsx`.
- The demo's shared space is host-hidden (`sidebar.hidden`) outside `?variant=drive`, so the workspace e2e keep their drive list.
- Column filters show raw values (`true` for booleans); a `render` only affects cells.
