import type { DragEvent, ReactNode } from "react";
import type { FmClient } from "../client/client";
import type { FmMountInfo } from "../core/schema";
import { cn } from "cn";
import { ChevronRightIcon, FolderIcon, HardDriveIcon, LockIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useListing } from "../client/hooks";
import { basename, isWithin } from "../core/path";
import { DRAG_TYPE } from "./file-list";
import { groupMountsByDriver } from "./mount-visibility";

interface TreeProps {
  client: FmClient;
  mount: string | undefined;
  path: string;
  /** The current view is the mount's trash. */
  inTrash: boolean;
  onNavigate: (mount: string, path: string) => void;
  onOpenTrash: (mount: string) => void;
  /** Entries of the current mount dropped onto `folder` of `mount`. */
  onDropEntries?: ((paths: string[], mount: string, folder: string) => void) | undefined;
}

function Children({ t, mount, path, depth }: { t: TreeProps; mount: string; path: string; depth: number }) {
  const listing = useListing(t.client, mount, path, "name", "asc");
  const dirs = listing.data?.pages.flatMap(p => p.items).filter(e => e.kind === "dir") ?? [];
  return dirs.map(d => <Node key={d.path} t={t} mount={mount} path={d.path} depth={depth} writable={d.caps.write} />);
}

function Row({ active, depth, expanded, onToggle, onClick, onDrop, icon, label, title }: {
  active: boolean;
  depth: number;
  expanded: boolean;
  /** Leaf rows have no toggle. */
  onToggle?: (() => void) | undefined;
  onClick: () => void;
  /** Makes the row a drop target for dragged entries. */
  onDrop?: ((paths: string[]) => void) | undefined;
  icon: ReactNode;
  label: string;
  title?: string;
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => !!onDrop && e.dataTransfer.types.includes(DRAG_TYPE);
  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-selected={active}
      title={title}
      className={cn("flex h-7 cursor-default items-center gap-1 rounded-md pr-2 text-sm select-none hover:bg-muted/60", active && "bg-accent text-accent-foreground", over && "ring-2 ring-primary")}
      style={{ paddingLeft: depth * 12 + 4 }}
      onClick={onClick}
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
          onDrop!(paths);
      }}
    >
      {onToggle
        ? (
            <button
              type="button"
              aria-label="toggle"
              className="flex size-4 items-center justify-center text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              <ChevronRightIcon className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
            </button>
          )
        : <span className="size-4" />}
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

/** Drop handler for a writable folder, or undefined. */
function dropOn(t: TreeProps, mount: string, folder: string, writable: boolean) {
  if (!writable || !t.onDropEntries)
    return undefined;
  const drop = t.onDropEntries;
  return (paths: string[]) => {
    const rest = t.mount === mount
      ? paths.filter(p => p !== folder)
      : paths;
    if (rest.length)
      drop(rest, mount, folder);
  };
}

function Node({ t, mount, path, depth, writable }: { t: TreeProps; mount: string; path: string; depth: number; writable: boolean }) {
  const onPath = t.mount === mount && !t.inTrash && isWithin(t.path, path) && t.path !== path;
  const [open, setOpen] = useState(onPath);
  const expanded = open || onPath;
  return (
    <>
      <Row
        active={t.mount === mount && !t.inTrash && t.path === path}
        depth={depth}
        expanded={expanded}
        onToggle={() => setOpen(!expanded)}
        onClick={() => t.onNavigate(mount, path)}
        onDrop={dropOn(t, mount, path, writable)}
        icon={<FolderIcon className="size-4 shrink-0 text-sky-500" />}
        label={basename(path)}
      />
      {expanded && <Children t={t} mount={mount} path={path} depth={depth + 1} />}
    </>
  );
}

function MountNode({ t, info, depth, readOnlyLabel, trashLabel }: { t: TreeProps; info: FmMountInfo; depth: number; readOnlyLabel: string; trashLabel: string }) {
  const [open, setOpen] = useState(t.mount === info.id);
  const readOnly = !info.caps.write;
  return (
    <>
      <Row
        active={t.mount === info.id && !t.inTrash && t.path === "/"}
        depth={depth}
        expanded={open}
        onToggle={() => setOpen(!open)}
        onClick={() => {
          setOpen(true);
          t.onNavigate(info.id, "/");
        }}
        onDrop={dropOn(t, info.id, "/", !readOnly)}
        icon={readOnly
          ? <LockIcon className="size-4 shrink-0 text-muted-foreground" />
          : <HardDriveIcon className="size-4 shrink-0 text-muted-foreground" />}
        label={info.label}
        {...(readOnly
          ? { title: readOnlyLabel }
          : {})}
      />
      {open && <Children t={t} mount={info.id} path="/" depth={depth + 1} />}
      {open && info.trash && (
        <Row
          active={t.mount === info.id && t.inTrash}
          depth={depth + 1}
          expanded={false}
          onClick={() => t.onOpenTrash(info.id)}
          icon={<Trash2Icon className="size-4 shrink-0 text-muted-foreground" />}
          label={trashLabel}
        />
      )}
    </>
  );
}

function GroupNode({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Row
        active={false}
        depth={0}
        expanded={open}
        onToggle={() => setOpen(!open)}
        onClick={() => setOpen(!open)}
        icon={null}
        label={label}
      />
      {open && <div role="group" aria-label={label} className="flex flex-col gap-px">{children}</div>}
    </>
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
  const node = (m: FmMountInfo, depth: number) => <MountNode key={m.id} t={props} info={m} depth={depth} readOnlyLabel={props.readOnlyLabel} trashLabel={props.trashLabel} />;
  return (
    <>
      <div role="tree" className="flex flex-col gap-px p-2">
        {props.group === "driver"
          ? groupMountsByDriver(props.mounts).map(g => (
              <GroupNode key={g.driver} label={props.groupLabel(g.driver)}>
                {g.mounts.map(m => node(m, 1))}
              </GroupNode>
            ))
          : props.mounts.map(m => node(m, 0))}
      </div>
      <button
        type="button"
        className="mx-2 mb-2 flex h-7 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        onClick={props.onManage}
      >
        <SettingsIcon className="size-4" />
        {props.manageLabel}
      </button>
    </>
  );
}
