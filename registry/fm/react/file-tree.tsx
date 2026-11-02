import type { ReactNode } from "react";
import type { FmClient } from "../client/client";
import type { MountInfo } from "../core/schema";
import { cn } from "cn";
import { ChevronRightIcon, FolderIcon, HardDriveIcon, LockIcon } from "lucide-react";
import { useState } from "react";
import { useListing } from "../client/hooks";
import { basename, isWithin } from "../core/path";

interface TreeProps {
  client: FmClient;
  mount: string | undefined;
  path: string;
  onNavigate: (mount: string, path: string) => void;
}

function Children({ t, mount, path, depth }: { t: TreeProps; mount: string; path: string; depth: number }) {
  const listing = useListing(t.client, mount, path, "name", "asc");
  const dirs = listing.data?.pages.flatMap(p => p.items).filter(e => e.kind === "dir") ?? [];
  return dirs.map(d => <Node key={d.path} t={t} mount={mount} path={d.path} depth={depth} />);
}

function Row({ active, depth, expanded, onToggle, onClick, icon, label, title }: {
  active: boolean;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-selected={active}
      title={title}
      className={cn("flex h-7 cursor-default items-center gap-1 rounded-md pr-2 text-sm select-none hover:bg-muted/60", active && "bg-accent text-accent-foreground")}
      style={{ paddingLeft: depth * 12 + 4 }}
      onClick={onClick}
    >
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
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

function Node({ t, mount, path, depth }: { t: TreeProps; mount: string; path: string; depth: number }) {
  const onPath = t.mount === mount && isWithin(t.path, path) && t.path !== path;
  const [open, setOpen] = useState(onPath);
  const expanded = open || onPath;
  return (
    <>
      <Row
        active={t.mount === mount && t.path === path}
        depth={depth}
        expanded={expanded}
        onToggle={() => setOpen(!expanded)}
        onClick={() => t.onNavigate(mount, path)}
        icon={<FolderIcon className="size-4 shrink-0 text-sky-500" />}
        label={basename(path)}
      />
      {expanded && <Children t={t} mount={mount} path={path} depth={depth + 1} />}
    </>
  );
}

function MountNode({ t, info, readOnlyLabel }: { t: TreeProps; info: MountInfo; readOnlyLabel: string }) {
  const [open, setOpen] = useState(t.mount === info.id);
  const readOnly = !info.caps.write;
  return (
    <>
      <Row
        active={t.mount === info.id && t.path === "/"}
        depth={0}
        expanded={open}
        onToggle={() => setOpen(!open)}
        onClick={() => {
          setOpen(true);
          t.onNavigate(info.id, "/");
        }}
        icon={readOnly
          ? <LockIcon className="size-4 shrink-0 text-muted-foreground" />
          : <HardDriveIcon className="size-4 shrink-0 text-muted-foreground" />}
        label={info.label}
        {...(readOnly
          ? { title: readOnlyLabel }
          : {})}
      />
      {open && <Children t={t} mount={info.id} path="/" depth={1} />}
    </>
  );
}

/** Sidebar tree: mounts at the top level, folders loaded lazily on expand. */
export function FileTree(props: TreeProps & { mounts: MountInfo[]; readOnlyLabel: string }) {
  return (
    <div role="tree" className="flex flex-col gap-px p-2">
      {props.mounts.map(m => <MountNode key={m.id} t={props} info={m} readOnlyLabel={props.readOnlyLabel} />)}
    </div>
  );
}
