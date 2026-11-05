import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import type { FmClient, FmListFilter } from "../client/client";
import type { FmEntry, FmMountInfo } from "../core/schema";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import { ChevronRightIcon, FolderIcon, HardDriveIcon, LockIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useListing } from "../client/hooks";
import { setDownloadUrl } from "./drop";
import { DRAG_TYPE, EntryIcon } from "./file-list";
import { groupMountsByDriver } from "./mount-visibility";

/** What a tree row stands for when it is right-clicked: a mount root or an entry. */
export interface FmTreeTarget {
  mount: string;
  entry?: FmEntry | undefined;
}

interface TreeProps {
  client: FmClient;
  mount: string | undefined;
  path: string;
  /** The current view is the mount's trash. */
  inTrash: boolean;
  onNavigate: (mount: string, path: string) => void;
  onOpenTrash: (mount: string) => void;
  /** A file row was clicked: show it in its folder. */
  onRevealFile: (entry: FmEntry) => void;
  /** Path of the single selected entry of the current mount. */
  selected?: string | undefined;
  /** Right-click on a row, before the context menu opens; undefined for rows without a menu. */
  onContextTarget?: ((target: FmTreeTarget | undefined) => void) | undefined;
  /** Expanded rows, keyed `mount:path`; a mount row uses `/`. */
  expanded: ReadonlySet<string>;
  onExpandedChange: (key: string, open: boolean) => void;
  /** Entries dropped onto `folder` of `mount`; `from` is their mount (the current one when absent). */
  onDropEntries?: ((paths: string[], mount: string, folder: string, from?: string) => void) | undefined;
  /** Hidden / ignored filter applied to every folder listing. */
  filter?: FmListFilter | undefined;
}

/** Expansion key of a folder row (`mount:path`); a mount row uses its root `/`. */
const treeKey = (mount: string, path: string) => `${mount}:${path}`;

const ROW_H = 28;
/** Top padding of the rows inside the scroll container. */
const PAD = 8;
const ROW = "w-full justify-start font-normal";
const ACTIVE = "bg-accent text-accent-foreground hover:bg-accent";
/** Rows of entries the driver marks ignored. */
const IGNORED = "opacity-60";
/** Source mount of entries dragged from the tree; list drags come from the current mount. */
const MOUNT_TYPE = "application/x-fm-mount";

/** One visible row of the flattened tree. */
type Row
  = | { kind: "group"; key: string; depth: number; driver: string; open: boolean }
    | { kind: "mount"; key: string; depth: number; info: FmMountInfo; open: boolean }
    | { kind: "dir"; key: string; depth: number; entry: FmEntry; open: boolean }
    | { kind: "file"; key: string; depth: number; entry: FmEntry }
    | { kind: "trash"; key: string; depth: number; mount: string };

/** Loads every page of an open folder and reports its entries; renders nothing. */
function FolderLoader({ t, mount, path, onEntries }: { t: TreeProps; mount: string; path: string; onEntries: (key: string, entries: FmEntry[]) => void }) {
  const listing = useListing(t.client, mount, path, "name", "asc", "", t.filter);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, data } = listing;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage)
      void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  useEffect(() => {
    if (data)
      onEntries(treeKey(mount, path), data.pages.flatMap(p => p.items));
  }, [data, mount, path, onEntries]);
  return null;
}

/** Tree item wrapper: accessible name / state, drag source and an optional drop target. */
function Item({ row, label, active, expanded, title, drag, onDrop, onContextMenu, children }: {
  row: { depth: number; index: number; start: number };
  label: string;
  active: boolean;
  expanded?: boolean | undefined;
  title?: string | undefined;
  /** Makes the row draggable as this entry (files also carry a desktop download). */
  drag?: { mount: string; path: string; entry?: FmEntry; client?: FmClient } | undefined;
  onDrop?: ((paths: string[], from: string | undefined) => void) | undefined;
  onContextMenu?: (() => void) | undefined;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => !!onDrop && e.dataTransfer.types.includes(DRAG_TYPE);
  return (
    <div
      role="treeitem"
      aria-label={label}
      aria-level={row.depth + 1}
      aria-expanded={expanded}
      aria-selected={active}
      data-index={row.index}
      title={title}
      className={cn("absolute inset-x-0 top-0 rounded-md", over && "ring-2 ring-primary")}
      style={{ height: ROW_H, transform: `translateY(${row.start - PAD}px)`, paddingLeft: row.depth * 16 }}
      onContextMenu={onContextMenu}
      draggable={!!drag}
      onDragStart={drag && ((e) => {
        e.stopPropagation();
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify([drag.path]));
        e.dataTransfer.setData(MOUNT_TYPE, drag.mount);
        if (drag.entry && drag.client)
          setDownloadUrl(e.dataTransfer, drag.client, drag.entry);
        e.dataTransfer.effectAllowed = "copyMove";
      })}
      onDragOver={(e) => {
        if (!accepts(e))
          return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!accepts(e))
          return;
        e.preventDefault();
        const paths = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[];
        if (paths.length)
          onDrop!(paths, e.dataTransfer.getData(MOUNT_TYPE) || undefined);
      }}
    >
      {children}
    </div>
  );
}

/** Drop handler for a writable folder, or undefined. */
function dropOn(t: TreeProps, mount: string, folder: string, writable: boolean) {
  if (!writable || !t.onDropEntries)
    return undefined;
  const drop = t.onDropEntries;
  return (paths: string[], from: string | undefined) => {
    const rest = (from ?? t.mount) === mount
      ? paths.filter(p => p !== folder)
      : paths;
    if (rest.length)
      drop(rest, mount, folder, from);
  };
}

/** Index of the parent row (the nearest row above with a smaller depth). */
function parentIndex(rows: readonly Row[], i: number) {
  for (let j = i - 1; j >= 0; j--) {
    if (rows[j]!.depth < rows[i]!.depth)
      return j;
  }
  return -1;
}

/**
 * Sidebar tree: mounts at the top level (or under driver sections), folders loaded lazily on expand.
 * Rows are flattened and virtualized inside `scrollRef`, so large folders stay cheap.
 */
export function FileTree(props: TreeProps & {
  mounts: FmMountInfo[];
  readOnlyLabel: string;
  trashLabel: string;
  group?: "none" | "driver" | undefined;
  groupLabel: (driver: string) => string;
  manageLabel: string;
  onManage: () => void;
  /** Scroll container of the tree. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Bumping it scrolls the selected row (or the current folder) into view once it is rendered. */
  revealTick?: number;
}) {
  const t = props;
  const [listings, setListings] = useState<ReadonlyMap<string, FmEntry[]>>(() => new Map());
  const onEntries = useCallback((key: string, entries: FmEntry[]) => setListings(m => new Map(m).set(key, entries)), []);
  const [closedGroups, setClosedGroups] = useState<ReadonlySet<string>>(() => new Set());

  const { rows, open } = useMemo(() => {
    const rows: Row[] = [];
    const open: { mount: string; path: string }[] = [];
    const folder = (mount: string, path: string, depth: number) => {
      open.push({ mount, path });
      for (const entry of listings.get(treeKey(mount, path)) ?? []) {
        if (entry.kind === "dir") {
          const key = treeKey(mount, entry.path);
          const isOpen = t.expanded.has(key);
          rows.push({
            kind: "dir",
            key,
            depth,
            entry,
            open: isOpen,
          });
          if (isOpen)
            folder(mount, entry.path, depth + 1);
        }
        else {
          rows.push({
            kind: "file",
            key: treeKey(mount, entry.path),
            depth,
            entry,
          });
        }
      }
    };
    const mountRows = (info: FmMountInfo, depth: number) => {
      const key = treeKey(info.id, "/");
      const isOpen = t.expanded.has(key);
      rows.push({
        kind: "mount",
        key,
        depth,
        info,
        open: isOpen,
      });
      if (!isOpen)
        return;
      folder(info.id, "/", depth + 1);
      if (info.trash) {
        rows.push({
          kind: "trash",
          key: `${info.id}:trash`,
          depth: depth + 1,
          mount: info.id,
        });
      }
    };
    if (props.group === "driver") {
      for (const g of groupMountsByDriver(props.mounts)) {
        const isOpen = !closedGroups.has(g.driver);
        rows.push({
          kind: "group",
          key: `group:${g.driver}`,
          depth: 0,
          driver: g.driver,
          open: isOpen,
        });
        if (isOpen)
          g.mounts.forEach(m => mountRows(m, 1));
      }
    }
    else {
      props.mounts.forEach(m => mountRows(m, 0));
    }
    return { rows, open };
  }, [
    listings,
    t.expanded,
    props.group,
    props.mounts,
    closedGroups,
  ]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => props.scrollRef.current,
    estimateSize: () => ROW_H,
    scrollMargin: PAD,
    overscan: 10,
  });

  const isActive = (row: Row) => {
    switch (row.kind) {
      case "mount": return t.mount === row.info.id && !t.inTrash && t.path === "/";
      case "dir": return t.mount === row.entry.mount && !t.inTrash && t.path === row.entry.path;
      case "file": return t.mount === row.entry.mount && !t.inTrash && t.selected === row.entry.path;
      case "trash": return t.mount === row.mount && t.inTrash;
      default: return false;
    }
  };

  // Reveal: once the active row exists, scroll to it (the last one is the deepest: file over folder).
  const pendingRevealRef = useRef(false);
  useEffect(() => {
    if (props.revealTick)
      pendingRevealRef.current = true;
  }, [props.revealTick]);
  useEffect(() => {
    if (!pendingRevealRef.current)
      return;
    const i = rows.findLastIndex(isActive);
    if (i < 0)
      return;
    pendingRevealRef.current = false;
    virtualizer.scrollToIndex(i, { align: "auto" });
  });

  const treeRef = useRef<HTMLDivElement>(null);
  /** Scrolls row `i` into view and focuses its button once rendered. */
  const focusRow = (i: number) => {
    if (i < 0 || i >= rows.length)
      return;
    virtualizer.scrollToIndex(i, { align: "auto" });
    let tries = 0;
    const focus = () => {
      const button = treeRef.current?.querySelector<HTMLElement>(`[data-index="${i}"] > button`);
      if (button)
        button.focus();
      else if (++tries < 10)
        requestAnimationFrame(focus);
    };
    focus();
  };
  const setOpen = (row: Row, isOpen: boolean) => {
    if (row.kind === "group") {
      setClosedGroups((s) => {
        const next = new Set(s);
        if (isOpen)
          next.delete(row.driver);
        else
          next.add(row.driver);
        return next;
      });
    }
    else {
      t.onExpandedChange(row.key, isOpen);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = Number((document.activeElement?.parentElement as HTMLElement | null)?.dataset.index ?? -1);
    const row = rows[i];
    if (!row)
      return;
    const expandable = "open" in row;
    let to: number | undefined;
    if (e.key === "ArrowDown") {
      to = i + 1;
    }
    else if (e.key === "ArrowUp") {
      to = i - 1;
    }
    else if (e.key === "Home") {
      to = 0;
    }
    else if (e.key === "End") {
      to = rows.length - 1;
    }
    else if (e.key === "ArrowRight" && expandable) {
      if (!row.open)
        setOpen(row, true);
      else if (rows[i + 1] && rows[i + 1]!.depth > row.depth)
        to = i + 1;
    }
    else if (e.key === "ArrowLeft") {
      if (expandable && row.open)
        setOpen(row, false);
      else
        to = parentIndex(rows, i);
    }
    else {
      return;
    }
    e.preventDefault();
    if (to !== undefined)
      focusRow(Math.max(0, Math.min(to, rows.length - 1)));
  };

  const chevron = (isOpen: boolean) => <ChevronRightIcon className={cn("transition-transform", isOpen && "rotate-90")} />;
  const renderRow = (row: Row, index: number, start: number) => {
    const at = { depth: row.depth, index, start };
    const active = isActive(row);
    switch (row.kind) {
      case "group": {
        const label = props.groupLabel(row.driver);
        return (
          <Item key={row.key} row={at} label={label} active={false} expanded={row.open}>
            <Button variant="ghost" size="sm" className={ROW} onClick={() => setOpen(row, !row.open)}>
              {chevron(row.open)}
              <span className="truncate">{label}</span>
            </Button>
          </Item>
        );
      }
      case "mount": {
        const { info } = row;
        const readOnly = !info.caps.write;
        return (
          <Item
            key={row.key}
            row={at}
            label={info.label}
            active={active}
            expanded={row.open}
            title={readOnly
              ? props.readOnlyLabel
              : undefined}
            onDrop={dropOn(t, info.id, "/", !readOnly)}
            onContextMenu={() => t.onContextTarget?.({ mount: info.id })}
          >
            <Button
              variant="ghost"
              size="sm"
              className={cn(ROW, active && ACTIVE)}
              onClick={() => {
                setOpen(row, !row.open);
                t.onNavigate(info.id, "/");
              }}
            >
              {chevron(row.open)}
              {readOnly
                ? <LockIcon className="text-muted-foreground" />
                : <HardDriveIcon className="text-muted-foreground" />}
              <span className="truncate">{info.label}</span>
            </Button>
          </Item>
        );
      }
      case "dir": {
        const { entry } = row;
        return (
          <Item
            key={row.key}
            row={at}
            label={entry.name}
            active={active}
            expanded={row.open}
            drag={entry.caps.move || entry.caps.copy
              ? { mount: entry.mount, path: entry.path }
              : undefined}
            onDrop={dropOn(t, entry.mount, entry.path, entry.caps.write)}
            onContextMenu={() => t.onContextTarget?.({ mount: entry.mount, entry })}
          >
            <Button
              variant="ghost"
              size="sm"
              className={cn(ROW, active && ACTIVE, entry.ignored && IGNORED)}
              onClick={() => {
                setOpen(row, !row.open);
                t.onNavigate(entry.mount, entry.path);
              }}
            >
              {chevron(row.open)}
              <FolderIcon className="text-sky-500" />
              <span className="truncate">{entry.name}</span>
            </Button>
          </Item>
        );
      }
      case "file": {
        const { entry } = row;
        return (
          <Item
            key={row.key}
            row={at}
            label={entry.name}
            active={active}
            drag={entry.caps.move || entry.caps.copy
              ? {
                  mount: entry.mount,
                  path: entry.path,
                  entry,
                  client: t.client,
                }
              : undefined}
            onContextMenu={() => t.onContextTarget?.({ mount: entry.mount, entry })}
          >
            <Button variant="ghost" size="sm" className={cn(ROW, active && ACTIVE, entry.ignored && IGNORED)} onClick={() => t.onRevealFile(entry)}>
              <EntryIcon entry={entry} />
              <span className="truncate">{entry.name}</span>
            </Button>
          </Item>
        );
      }
      case "trash":
        return (
          <Item key={row.key} row={at} label={props.trashLabel} active={active} onContextMenu={() => t.onContextTarget?.(undefined)}>
            <Button variant="ghost" size="sm" className={cn(ROW, active && ACTIVE)} onClick={() => t.onOpenTrash(row.mount)}>
              <Trash2Icon className="text-muted-foreground" />
              <span className="truncate">{props.trashLabel}</span>
            </Button>
          </Item>
        );
    }
  };

  return (
    <>
      {open.map(f => <FolderLoader key={treeKey(f.mount, f.path)} t={t} mount={f.mount} path={f.path} onEntries={onEntries} />)}
      <div className="px-2 pt-2 text-sm">
        <div
          ref={treeRef}
          role="tree"
          className="relative"
          style={{
            height: virtualizer.getTotalSize(),
          }}
          onKeyDown={onKeyDown}
        >
          {virtualizer.getVirtualItems().map(v => renderRow(rows[v.index]!, v.index, v.start))}
        </div>
      </div>
      <Button variant="ghost" size="sm" className="mx-2 my-2 justify-start font-normal text-muted-foreground" onClick={props.onManage}>
        <SettingsIcon />
        {props.manageLabel}
      </Button>
    </>
  );
}
