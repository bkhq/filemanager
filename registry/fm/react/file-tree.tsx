import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import type { FmClient, FmListFilter } from "../client/client";
import type { FmEntry, FmMountInfo } from "../core/schema";
import { cn } from "cn";
import { ChevronRightIcon, FolderIcon, HardDriveIcon, LockIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useListing } from "../client/hooks";
import { basename, isWithin } from "../core/path";
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
  /** Entries of the current mount dropped onto `folder` of `mount`. */
  /** Entries dropped onto `folder` of `mount`; `from` is their mount (the current one when absent). */
  onDropEntries?: ((paths: string[], mount: string, folder: string, from?: string) => void) | undefined;
  /** Hidden / ignored filter applied to every folder listing. */
  filter?: FmListFilter | undefined;
}

const ROW = "w-full justify-start font-normal aria-expanded:bg-transparent aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/50";
const ACTIVE = "bg-accent text-accent-foreground aria-expanded:bg-accent aria-expanded:hover:bg-accent";
/** Rows of entries the driver marks ignored. */
const IGNORED = "opacity-60";
const ROW_BUTTON = "[role=treeitem] > button";
/** Source mount of entries dragged from the tree; list drags come from the current mount. */
const MOUNT_TYPE = "application/x-fm-mount";

/** Visible row buttons in order; collapsed branches are not rendered. */
function rowButtons(tree: HTMLElement) {
  return [
    ...tree.querySelectorAll<HTMLElement>(ROW_BUTTON),
  ];
}

/** Focuses the row of the branch that contains `el`. */
function focusParent(el: HTMLElement) {
  el.closest("[data-slot=collapsible-content]")?.parentElement?.querySelector<HTMLElement>(`:scope > ${ROW_BUTTON}`)?.focus();
}

/** Arrow Right / Left on a row: expand, enter, collapse or go to the parent. */
function onRowKeyDown(e: KeyboardEvent<HTMLElement>, setOpen?: (open: boolean) => void) {
  // The trigger keeps aria-expanded current; a closure value can be stale.
  const expanded = e.currentTarget.getAttribute("aria-expanded") === "true";
  if (e.key === "ArrowRight" && setOpen) {
    e.preventDefault();
    if (!expanded)
      setOpen(true);
    else
      e.currentTarget.closest("[data-slot=collapsible]")?.querySelector<HTMLElement>(`:scope > [data-slot=collapsible-content] ${ROW_BUTTON}`)?.focus();
  }
  else if (e.key === "ArrowLeft") {
    e.preventDefault();
    if (setOpen && expanded)
      setOpen(false);
    else
      focusParent(e.currentTarget);
  }
}

/** Arrow Up / Down, Home and End move between visible rows. */
function onTreeKeyDown(e: KeyboardEvent<HTMLElement>) {
  const rows = rowButtons(e.currentTarget);
  const i = rows.indexOf(document.activeElement as HTMLElement);
  if (i < 0)
    return;
  const to = {
    ArrowDown: i + 1,
    ArrowUp: i - 1,
    Home: 0,
    End: rows.length - 1,
  }[e.key];
  if (to === undefined)
    return;
  e.preventDefault();
  rows[Math.max(0, Math.min(to, rows.length - 1))]?.focus();
}

/** Folders and files of `path`, loaded when the parent opens; follows every page of the listing. */
function Children({ t, mount, path }: { t: TreeProps; mount: string; path: string }) {
  const listing = useListing(t.client, mount, path, "name", "asc", "", t.filter);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = listing;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage)
      void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const entries = listing.data?.pages.flatMap(p => p.items) ?? [];
  return entries.map(e => (e.kind === "dir"
    ? <Node key={e.path} t={t} entry={e} />
    : <FileLeaf key={e.path} t={t} entry={e} />));
}

function FileLeaf({ t, entry }: { t: TreeProps; entry: FmEntry }) {
  const active = t.mount === entry.mount && !t.inTrash && t.selected === entry.path;
  return (
    <Item
      label={entry.name}
      active={active}
      drag={entry.caps.move || entry.caps.copy
        ? { mount: entry.mount, path: entry.path }
        : undefined}
      onContextMenu={() => t.onContextTarget?.({ mount: entry.mount, entry })}
    >
      <Button variant="ghost" size="sm" className={cn(ROW, active && ACTIVE, entry.ignored && IGNORED)} onClick={() => t.onRevealFile(entry)} onKeyDown={e => onRowKeyDown(e)}>
        <EntryIcon entry={entry} />
        <span className="truncate">{entry.name}</span>
      </Button>
    </Item>
  );
}

/** Tree item wrapper: accessible name / state and an optional drop target. */
function Item({ label, active, expanded, title, drag, onDrop, onContextMenu, children }: {
  label: string;
  active: boolean;
  expanded?: boolean | undefined;
  title?: string | undefined;
  /** Makes the row draggable as this entry. */
  drag?: { mount: string; path: string } | undefined;
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
      aria-expanded={expanded}
      aria-selected={active}
      title={title}
      className={cn("rounded-md", over && "ring-2 ring-primary")}
      onContextMenu={onContextMenu}
      draggable={!!drag}
      onDragStart={drag && ((e) => {
        e.stopPropagation();
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify([drag.path]));
        e.dataTransfer.setData(MOUNT_TYPE, drag.mount);
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

/**
 * Collapsible tree row: chevron, icon and label in one trigger button. A click
 * toggles the row and runs `onClick` (navigation).
 */
function Branch({ label, icon, active, dimmed, open, onOpenChange, onClick, drag, onDrop, onContextMenu, title, children }: {
  label: string;
  icon: ReactNode;
  active: boolean;
  dimmed?: boolean | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClick?: (() => void) | undefined;
  drag?: { mount: string; path: string } | undefined;
  onDrop?: ((paths: string[], from: string | undefined) => void) | undefined;
  onContextMenu?: (() => void) | undefined;
  title?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Item label={label} active={active} expanded={open} title={title} drag={drag} onDrop={onDrop} onContextMenu={onContextMenu}>
        <CollapsibleTrigger
          render={(
            <Button
              variant="ghost"
              size="sm"
              className={cn(ROW, active && ACTIVE, dimmed && IGNORED)}
              onClick={onClick}
              onKeyDown={e => onRowKeyDown(e, onOpenChange)}
            >
              <ChevronRightIcon className="transition-transform group-data-panel-open/button:rotate-90" />
              {icon}
              <span className="truncate">{label}</span>
            </Button>
          )}
        />
      </Item>
      <CollapsibleContent>
        <div className="ml-4 flex flex-col">{children}</div>
      </CollapsibleContent>
    </Collapsible>
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

function Node({ t, entry }: { t: TreeProps; entry: FmEntry }) {
  const { mount, path } = entry;
  const onPath = t.mount === mount && !t.inTrash && isWithin(t.path, path) && t.path !== path;
  const [open, setOpen] = useState(onPath);
  // Opens when navigation enters the subtree; clicks can still collapse it.
  const [wasOnPath, setWasOnPath] = useState(onPath);
  if (onPath !== wasOnPath) {
    setWasOnPath(onPath);
    if (onPath)
      setOpen(true);
  }
  return (
    <Branch
      label={basename(path)}
      icon={<FolderIcon className="text-sky-500" />}
      active={t.mount === mount && !t.inTrash && t.path === path}
      dimmed={entry.ignored}
      open={open}
      onOpenChange={setOpen}
      onClick={() => t.onNavigate(mount, path)}
      drag={entry.caps.move || entry.caps.copy
        ? { mount, path }
        : undefined}
      onDrop={dropOn(t, mount, path, entry.caps.write)}
      onContextMenu={() => t.onContextTarget?.({ mount, entry })}
    >
      <Children t={t} mount={mount} path={path} />
    </Branch>
  );
}

function MountNode({ t, info, readOnlyLabel, trashLabel }: { t: TreeProps; info: FmMountInfo; readOnlyLabel: string; trashLabel: string }) {
  const current = t.mount === info.id;
  const [open, setOpen] = useState(current);
  const [wasCurrent, setWasCurrent] = useState(current);
  if (current !== wasCurrent) {
    setWasCurrent(current);
    if (current)
      setOpen(true);
  }
  const readOnly = !info.caps.write;
  const trashActive = t.mount === info.id && t.inTrash;
  return (
    <Branch
      label={info.label}
      icon={readOnly
        ? <LockIcon className="text-muted-foreground" />
        : <HardDriveIcon className="text-muted-foreground" />}
      active={t.mount === info.id && !t.inTrash && t.path === "/"}
      open={open}
      onOpenChange={setOpen}
      onClick={() => t.onNavigate(info.id, "/")}
      onDrop={dropOn(t, info.id, "/", !readOnly)}
      onContextMenu={() => t.onContextTarget?.({ mount: info.id })}
      title={readOnly
        ? readOnlyLabel
        : undefined}
    >
      <Children t={t} mount={info.id} path="/" />
      {info.trash && (
        <Item label={trashLabel} active={trashActive} onContextMenu={() => t.onContextTarget?.(undefined)}>
          <Button variant="ghost" size="sm" className={cn(ROW, trashActive && ACTIVE)} onClick={() => t.onOpenTrash(info.id)} onKeyDown={e => onRowKeyDown(e)}>
            <Trash2Icon className="text-muted-foreground" />
            <span className="truncate">{trashLabel}</span>
          </Button>
        </Item>
      )}
    </Branch>
  );
}

function GroupNode({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <Branch label={label} icon={null} active={false} open={open} onOpenChange={setOpen}>
      <div role="group" aria-label={label} className="flex flex-col">{children}</div>
    </Branch>
  );
}

/** Sidebar tree: mounts at the top level (or under driver sections), folders loaded lazily on expand. */
export function FileTree(props: TreeProps & {
  mounts: FmMountInfo[];
  readOnlyLabel: string;
  trashLabel: string;
  group?: "none" | "driver" | undefined;
  groupLabel: (driver: string) => string;
  manageLabel: string;
  onManage: () => void;
}) {
  const node = (m: FmMountInfo) => <MountNode key={m.id} t={props} info={m} readOnlyLabel={props.readOnlyLabel} trashLabel={props.trashLabel} />;
  return (
    <>
      <div role="tree" className="flex flex-col p-2 text-sm" onKeyDown={onTreeKeyDown}>
        {props.group === "driver"
          ? groupMountsByDriver(props.mounts).map(g => (
              <GroupNode key={g.driver} label={props.groupLabel(g.driver)}>
                {g.mounts.map(node)}
              </GroupNode>
            ))
          : props.mounts.map(node)}
      </div>
      <Button variant="ghost" size="sm" className="mx-2 mb-2 justify-start font-normal text-muted-foreground" onClick={props.onManage}>
        <SettingsIcon />
        {props.manageLabel}
      </Button>
    </>
  );
}
