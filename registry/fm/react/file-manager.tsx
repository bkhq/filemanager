import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from "react";
import type { FmClient } from "../client/client";
import type { FmUploadFile } from "../client/upload";
import type { FmEntry, FmOpsRequest, FmSortKey } from "../core/schema";
import type { FmFeatures } from "./features";
import type { FmLabels } from "./labels";
import type { FmActionContext, FmFileAction, FmPlugin } from "./plugins";
import type { FmClipboard, FmSelection, FmSelectMode } from "./state";
import type { FmUndo } from "./undo";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ClipboardCopyIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  DownloadIcon,
  FilePlusIcon,
  FileSearchIcon,
  FolderPlusIcon,
  FolderUpIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  PanelLeftIcon,
  PencilIcon,
  RefreshCwIcon,
  ScissorsIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { createFmClient } from "../client/client";
import { fmKeys, useFmMutations, useListing, useMounts, useSearch, useTrash } from "../client/hooks";
import { createUploadQueue, xhrTransport } from "../client/upload";
import { basename, dirname, joinPath } from "../core/path";
import { acceptsEntry } from "./accept";
import { DetailsPanel } from "./details-panel";
import { ConfirmDeleteDialog, ManageDrivesDialog, NameDialog, UploadConflictDialog } from "./dialogs";
import { filesFromDrop, filesFromInput } from "./drop";
import { maskEntry, resolveFeatures } from "./features";
import { FileList } from "./file-list";
import { FileTree } from "./file-tree";
import { IconButton } from "./icon-button";
import { enLabels } from "./labels";
import { groupMountsByDriver, parseHidden, visibleMounts } from "./mount-visibility";
import { PreviewDialog } from "./preview-dialog";
import { QuickOpen } from "./quick-open";
import { EMPTY_SELECTION, formatSize, kindOf, prune, select, step } from "./state";
import { TrashView } from "./trash-view";
import { undoFor } from "./undo";
import { UploadPanel } from "./upload-panel";

export type { FmActionContext, FmFileAction, FmPlugin } from "./plugins";

export interface FmSidebarOptions {
  /** Mount ids left out of the tree and the storage menu (still reachable via `initialMount`). */
  hidden?: string[];
  /** `driver`: one section per driver kind. */
  group?: "none" | "driver";
}

export interface FmPickOptions {
  /** Extensions (`.png`) and MIME types (`image/*`); empty accepts every file. */
  accept?: string[];
  multiple?: boolean;
  /** Confirm is disabled while the selected files exceed this many bytes. */
  maxTotalSize?: number;
  onPick: (entries: FmEntry[]) => void;
  onCancel?: () => void;
}

export interface FileManagerProps {
  /** Router base URL (e.g. `/api/fm`); ignored when `client` is given. */
  baseUrl?: string;
  client?: FmClient;
  labels?: FmLabels;
  initialMount?: string;
  initialPath?: string;
  /** Extra actions for the entry context menu (share, attach …). */
  actions?: FmFileAction[];
  /** Optional extensions: previewers for more file types and their actions. */
  plugins?: FmPlugin[];
  className?: string;
  /** localStorage key prefix for the view / layout preferences. */
  storageKey?: string;
  /**
   * Initial layout: folder tree beside the list (`split`) or the list alone
   * (`single`). Users can toggle it; containers narrower than 640px always use `single`.
   */
  layout?: "split" | "single";
  /** View-only preset: browse, preview, search and download. */
  readOnly?: boolean;
  /** Per-feature switches applied on top of `readOnly`, e.g. `{ delete: false }`. */
  features?: Partial<FmFeatures>;
  /** Sidebar drive visibility and grouping; users can hide more via "Manage drives". */
  sidebar?: FmSidebarOptions;
  /**
   * Pick mode, used by `FilePicker`: files are selected and confirmed instead of previewed.
   * @internal
   */
  pick?: FmPickOptions;
}

type DialogState
  = | { kind: "mkdir" }
    | { kind: "rename"; entry: FmEntry }
    | { kind: "delete"; paths: string[] }
    | { kind: "newFile" }
    | { kind: "emptyTrash" }
    | { kind: "manageDrives" }
    | { kind: "uploadConflict"; files: FmUploadFile[]; clashes: Set<string> }
    | undefined;

/** First path segment of an upload below the target folder. */
const topName = (f: FmUploadFile) => (f.relativePath || f.file.name).replace(/^\/+/, "").split("/")[0]!;

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
}

/** A string choice persisted in localStorage. */
function useStoredChoice<T extends string>(key: string, values: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = typeof localStorage !== "undefined"
      ? localStorage.getItem(key)
      : null;
    return values.find(v => v === stored) ?? fallback;
  });
  const change = (v: T) => {
    setValue(v);
    localStorage.setItem(key, v);
  };
  return [value, change] as const;
}

/** A list of strings persisted in localStorage as JSON. */
function useStoredList(key: string) {
  const [value, setValue] = useState(() => parseHidden(typeof localStorage !== "undefined"
    ? localStorage.getItem(key)
    : null));
  const change = (v: string[]) => {
    setValue(v);
    localStorage.setItem(key, JSON.stringify(v));
  };
  return [value, change] as const;
}

const NARROW = 640;

/** Width of an element, tracked with ResizeObserver (0 until measured). */
function useWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el)
      return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

export function FileManager(props: FileManagerProps) {
  const labels = props.labels ?? enLabels;
  const [client] = useState(() => props.client ?? createFmClient({ baseUrl: props.baseUrl ?? "/api/fm" }));
  const qc = useQueryClient();
  const mounts = useMounts(client);
  const pluginPreviewers = useMemo(() => (props.plugins ?? []).flatMap(p => p.previewers ?? []), [props.plugins]);
  const features = useMemo(() => resolveFeatures(props.readOnly, props.features), [props.readOnly, props.features]);
  const [location, setLocation] = useState({ mount: props.initialMount, path: props.initialPath ?? "/", trash: false });
  const storageKey = props.storageKey ?? "fm";
  const hostHidden = props.sidebar?.hidden ?? [];
  const [userHidden, setUserHidden] = useStoredList(`${storageKey}:hidden`);
  const mount = location.mount ?? (mounts.data && (visibleMounts(mounts.data, hostHidden, userHidden, undefined)[0] ?? mounts.data[0]))?.id;
  const shownMounts = mounts.data && visibleMounts(mounts.data, hostHidden, userHidden, mount);
  const { path, trash: inTrash } = location;
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"folder" | "below">("folder");
  const [view, setView] = useStoredChoice(`${storageKey}:view`, ["list", "grid"], "list");
  const [layout, setLayout] = useStoredChoice(`${storageKey}:layout`, ["split", "single"], props.layout ?? "split");
  const [rootRef, width] = useWidth();
  const narrow = width > 0 && width < NARROW;
  const split = layout === "split" && !narrow;
  const [sort, setSort] = useState<{ key: FmSortKey; order: "asc" | "desc" }>({ key: "name", order: "asc" });
  const [rawSelection, setRawSelection] = useState<FmSelection>(EMPTY_SELECTION);
  const [clipboard, setClipboard] = useState<FmClipboard>();
  const [preview, setPreview] = useState<FmEntry>();
  const [dialog, setDialog] = useState<DialogState>();
  const [quickOpen, setQuickOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<{ message: string; undo?: () => void }>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const listing = useListing(client, mount, path, sort.key, sort.order, query.trim());
  const below = features.search && searchScope === "below" && !!query.trim();
  const search = useSearch(client, mount, path, query.trim(), below);
  const items = useMemo(() => (below
    ? search.data?.items
    : listing.data?.pages.flatMap(p => p.items)), [below, search.data, listing.data]);
  const entries = useMemo(() => items?.map(e => maskEntry(e, features)) ?? [], [items, features]);
  const rawDir = listing.data?.pages[0]?.entry;
  const dir = useMemo(() => rawDir && maskEntry(rawDir, features), [rawDir, features]);
  const order = useMemo(() => entries.map(e => e.path), [entries]);
  const byPath = useMemo(() => new Map(entries.map(e => [e.path, e])), [entries]);
  const { pick } = props;
  const pickable = (e: FmEntry) => e.kind === "file" && acceptsEntry(e, pick?.accept);
  const selection = useMemo(() => {
    const sel = prune(rawSelection, order);
    if (!pick)
      return sel;
    // Only accepted files can be picked; single mode keeps the latest one.
    const paths = [...sel.paths].filter((p) => {
      const e = byPath.get(p);
      return !!e && e.kind === "file" && acceptsEntry(e, pick.accept);
    });
    return {
      paths: new Set(pick.multiple
        ? paths
        : paths.slice(-1)),
      anchor: sel.anchor,
    };
  }, [rawSelection, order, pick, byPath]);
  const selected = useMemo(() => [...selection.paths].map(p => byPath.get(p)).filter((e): e is FmEntry => !!e), [selection, byPath]);
  const mutations = useFmMutations(client, mount ?? "");
  const canWrite = !!dir?.caps.write;
  const canUpload = canWrite && features.upload;
  const canMkdir = canWrite && features.createFolder;
  const canNewFile = canWrite && features.createFile;

  const onUploadedRef = useRef(() => {});
  onUploadedRef.current = () => void mutations.invalidate();
  const [queue] = useState(() => createUploadQueue({
    transport: xhrTransport(client),
    onUploaded: () => onUploadedRef.current(),
  }));

  const shownError = error ?? listing.error?.message ?? (below
    ? search.error?.message
    : undefined);
  const currentMount = mounts.data?.find(m => m.id === mount);
  const trashItems = useTrash(client, mount, inTrash).data ?? [];

  useEffect(() => {
    if (!notice)
      return;
    const timer = setTimeout(setNotice, 8000, undefined);
    return () => clearTimeout(timer);
  }, [notice]);

  const go = useCallback((m: string, p: string, trash: boolean) => {
    setLocation({ mount: m, path: p, trash });
    setRawSelection(EMPTY_SELECTION);
    setQuery("");
    setSearchScope("folder");
    setError(undefined);
  }, []);
  const navigate = useCallback((m: string, p: string) => go(m, p, false), [go]);

  const changeQuery = (q: string) => {
    setQuery(q);
    if (!q.trim())
      setSearchScope("folder");
  };

  const failedMessage = (results: { ok: boolean; error?: { message: string } | undefined }[]) => {
    const failed = results.filter(r => !r.ok);
    return failed.length
      ? `${labels.failed(failed.length)}: ${failed[0]!.error?.message ?? ""}`
      : undefined;
  };

  const runUndo = async (m: string, undo: FmUndo) => {
    setNotice(undefined);
    try {
      const results = "restore" in undo
        ? (await client.restore(m, undo.restore)).results
        : [];
      if ("ops" in undo) {
        for (const req of undo.ops)
          results.push(...(await client.ops(m, req)).results);
      }
      setError(failedMessage(results));
    }
    catch (e) {
      setError(e instanceof Error
        ? e.message
        : String(e));
    }
    await qc.invalidateQueries({
      queryKey: fmKeys.all(client),
    });
  };

  const doneMessage = (req: FmOpsRequest, n: number) => {
    switch (req.op) {
      case "delete": return labels.movedToTrash(n);
      case "rename": return labels.renamed;
      case "move": return labels.movedItems(n);
      default: return labels.copiedItems(n);
    }
  };

  /** `from`: source mount when it is not the current one. */
  const runOps = (req: FmOpsRequest, after?: () => void, from?: string) => {
    const m = from ?? mount;
    // No undo across mounts: it would have to run on both.
    const crossMount = (!!from && from !== mount) || ("destMount" in req && !!req.destMount && req.destMount !== m);
    mutations.ops.mutate(from
      ? { mount: from, req }
      : req, {
      onSuccess: (res) => {
        setError(failedMessage(res.results));
        const undo = m && !crossMount && undoFor(req, res.results);
        setNotice(undo
          ? {
              message: doneMessage(req, res.results.filter(r => r.ok).length),
              undo: () => void runUndo(m, undo),
            }
          : undefined);
        after?.();
      },
      onError: e => setError(e.message),
    });
  };

  /** Mounts with a trash delete right away (undo is offered); others confirm first. */
  const requestDelete = (paths: string[]) => {
    if (currentMount?.trash)
      runOps({ op: "delete", paths }, () => setRawSelection(EMPTY_SELECTION));
    else
      setDialog({ kind: "delete", paths });
  };

  const open = (e: FmEntry) => {
    if (e.kind === "dir")
      navigate(e.mount, e.path);
    else if (!pick)
      setPreview(e);
    else if (pickable(e) && pick.multiple)
      setRawSelection(s => select(s, e.path, "toggle", order));
    else if (pickable(e))
      pick.onPick([e]);
  };

  /** Search hit: go to its folder with the hit selected. */
  const reveal = (e: FmEntry) => {
    navigate(e.mount, dirname(e.path));
    setRawSelection({
      paths: new Set([e.path]),
      anchor: e.path,
    });
  };
  const openEntry = below
    ? reveal
    : open;

  /** Quick-open pick: a folder opens, a file previews within its folder. */
  const pickQuickOpen = (e: FmEntry) => {
    if (e.kind === "dir")
      return navigate(e.mount, e.path);
    navigate(e.mount, dirname(e.path));
    setPreview(maskEntry(e, features));
  };
  const canQuickOpen = features.search && !inTrash && !!mount;

  const download = (targets: FmEntry[]) => {
    if (!mount || targets.length === 0)
      return;
    const only = targets[0]!;
    triggerDownload(targets.length === 1 && only.kind === "file"
      ? client.readUrl(mount, only.path, { download: true })
      : client.archiveUrl(mount, targets.map(t => t.path)));
  };

  const copyToClipboard = (mode: FmClipboard["mode"], targets: FmEntry[]) => {
    if (mount && targets.length) {
      setClipboard({
        mode,
        mount,
        paths: targets.map(t => t.path),
      });
    }
  };

  const canPaste = !!clipboard && !!mount && canWrite;
  const paste = () => {
    if (!clipboard || !canPaste)
      return;
    runOps({
      op: clipboard.mode === "cut"
        ? "move"
        : "copy",
      paths: clipboard.paths,
      dest: path,
      ...(clipboard.mount !== mount
        ? { destMount: mount }
        : {}),
      conflict: "rename",
    }, () => {
      if (clipboard.mode === "cut")
        setClipboard(undefined);
    }, clipboard.mount);
  };

  /** Tree drop: move within the mount, copy to another one. */
  const dropEntries = (paths: string[], to: string, folder: string) => {
    if (!mount)
      return;
    const cross = to !== mount;
    if ((cross && !features.copy) || (!cross && !features.move))
      return;
    runOps({
      op: cross
        ? "copy"
        : "move",
      paths,
      dest: folder,
      ...(cross
        ? { destMount: to }
        : {}),
      conflict: "rename",
    });
  };

  const copyContents = async (entry: FmEntry) => {
    if (!mount)
      return;
    try {
      const { text } = await client.readText(mount, entry.path);
      await navigator.clipboard.writeText(text);
      setNotice({ message: labels.contentsCopied });
    }
    catch (e) {
      setError(e instanceof Error
        ? e.message
        : String(e));
    }
  };

  const upload = async (files: FmUploadFile[]) => {
    if (!mount || files.length === 0)
      return;
    const names = [
      ...new Set(files.map(topName)),
    ];
    // Trust the loaded listing only when it is current, unfiltered and complete; otherwise ask the server.
    const complete = listing.isSuccess && !listing.isFetching && !query.trim() && !listing.hasNextPage;
    const existing = complete
      ? new Set(entries.map(e => e.name))
      : new Set(await Promise.all(names.map(n => client.stat(mount, joinPath(path, n)).then(() => n, () => ""))));
    const clashes = new Set(files.filter(f => !(f.relativePath ?? "").includes("/")).map(topName).filter(n => existing.has(n)));
    if (clashes.size)
      setDialog({ kind: "uploadConflict", files, clashes });
    else
      queue.getState().enqueue(mount, path, files);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    void upload(filesFromInput(e.target.files!));
    e.target.value = "";
  };

  const onSelect = (p: string, mode: FmSelectMode) => setRawSelection(s => select(s, p, pick
    ? (pick.multiple
        ? (mode === "single"
            ? "toggle"
            : mode)
        : "single")
    : mode, order));

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    // Before the input check so it also works from the search box.
    if (mod && e.key.toLowerCase() === "p" && canQuickOpen && !dialog && !preview && !quickOpen) {
      e.preventDefault();
      setQuickOpen(true);
      return;
    }
    if (inTrash || dialog || preview || (e.target as HTMLElement).closest("input, textarea, [contenteditable]"))
      return;
    const one = selected.length === 1
      ? selected[0]
      : undefined;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        setRawSelection(s => step(prune(s, order), order, 1, e.shiftKey));
        break;
      case "ArrowUp":
      case "ArrowLeft":
        setRawSelection(s => step(prune(s, order), order, -1, e.shiftKey));
        break;
      case "Enter":
        if (pick && selection.anchor !== undefined && byPath.has(selection.anchor))
          open(byPath.get(selection.anchor)!);
        else if (one)
          openEntry(one);
        break;
      case "Backspace":
        if (mount && path !== "/")
          navigate(mount, dirname(path));
        break;
      case "Delete":
        if (selected.length && selected.every(x => x.caps.delete))
          requestDelete(selected.map(x => x.path));
        break;
      case "F2":
        if (one?.caps.rename)
          setDialog({ kind: "rename", entry: one });
        break;
      case "Escape":
        setRawSelection(EMPTY_SELECTION);
        break;
      case "a":
        if (!mod)
          return;
        setRawSelection({
          paths: new Set(order),
          anchor: order[0],
        });
        break;
      case "c":
        if (!mod)
          return;
        if (selected.every(x => x.caps.copy))
          copyToClipboard("copy", selected);
        break;
      case "x":
        if (!mod)
          return;
        if (selected.every(x => x.caps.move))
          copyToClipboard("cut", selected);
        break;
      case "v":
        if (!mod)
          return;
        paste();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onDragOver = (e: DragEvent) => {
    if (!canUpload || !e.dataTransfer.types.includes("Files"))
      return;
    e.preventDefault();
    setDropActive(true);
  };
  const onDrop = (e: DragEvent) => {
    setDropActive(false);
    if (!canUpload || !e.dataTransfer.types.includes("Files"))
      return;
    e.preventDefault();
    void filesFromDrop(e.dataTransfer).then(upload);
  };

  const menuItem = (key: string, label: string, icon: ReactNode, fn: () => void, opts: { show?: boolean; destructive?: boolean } = {}) =>
    opts.show === false
      ? null
      : (
          <ContextMenuItem key={key} variant={opts.destructive ? "destructive" : "default"} onClick={fn}>
            {icon}
            {label}
          </ContextMenuItem>
        );

  const runAction = (action: FmFileAction, targets: FmEntry[]) => {
    if (!mount)
      return;
    const ctx: FmActionContext = {
      client,
      mount,
      path,
      refresh: async () => {
        await qc.invalidateQueries({
          queryKey: fmKeys.all(client),
        });
      },
      preview: setPreview,
      fail: setError,
    };
    void Promise.resolve(action.run(targets, ctx)).catch((e: unknown) => setError(e instanceof Error
      ? e.message
      : String(e)));
  };

  const entryMenu = (targets: FmEntry[]) => {
    const one = targets.length === 1
      ? targets[0]
      : undefined;
    const custom = [
      ...(props.actions ?? []),
      ...(props.plugins ?? []).flatMap(p => p.actions ?? []),
    ]
      .filter(a => !a.when || a.when(targets));
    return [
      one && menuItem("open", labels.open, null, () => open(one)),
      menuItem("download", labels.download, <DownloadIcon />, () => download(targets), { show: features.download }),
      <ContextMenuSeparator key="s1" />,
      menuItem("copy", labels.copy, <CopyIcon />, () => copyToClipboard("copy", targets), {
        show: targets.every(t => t.caps.copy),
      }),
      menuItem("cut", labels.cut, <ScissorsIcon />, () => copyToClipboard("cut", targets), {
        show: targets.every(t => t.caps.move),
      }),
      one && menuItem("rename", labels.rename, <PencilIcon />, () => setDialog({ kind: "rename", entry: one }), { show: one.caps.rename }),
      menuItem("duplicate", labels.duplicate, <CopyPlusIcon />, () => runOps({
        op: "copy",
        paths: targets.map(t => t.path),
        dest: path,
        conflict: "rename",
      }), { show: canWrite && targets.every(t => t.caps.copy) }),
      one && menuItem("copyContents", labels.copyContents, <ClipboardCopyIcon />, () => void copyContents(one), {
        show: features.download && !inTrash && one.kind === "file" && kindOf(one) === "text" && one.size <= 1024 * 1024,
      }),
      one && menuItem("details", labels.details, <InfoIcon />, () => setDetailsOpen(true), { show: features.details }),
      custom.length > 0 && <ContextMenuSeparator key="s2" />,
      ...custom.map(a => menuItem(`x-${a.id}`, a.label, a.icon, () => runAction(a, targets))),
      <ContextMenuSeparator key="s3" />,
      menuItem("delete", labels.delete, <Trash2Icon />, () => requestDelete(targets.map(t => t.path)), {
        show: targets.every(t => t.caps.delete),
        destructive: true,
      }),
    ];
  };

  const blankMenu = () => [
    menuItem("mkdir", labels.newFolder, <FolderPlusIcon />, () => setDialog({ kind: "mkdir" }), { show: canMkdir }),
    menuItem("newFile", labels.newFile, <FilePlusIcon />, () => setDialog({ kind: "newFile" }), { show: canNewFile }),
    menuItem("upload", labels.upload, <UploadIcon />, () => fileInputRef.current?.click(), { show: canUpload }),
    menuItem("paste", labels.paste, <ClipboardPasteIcon />, paste, { show: canPaste }),
    menuItem("refresh", labels.refresh, <RefreshCwIcon />, () => void listing.refetch()),
  ];

  const crumbs = path === "/"
    ? []
    : path.slice(1).split("/");

  if (mounts.data && mounts.data.length === 0)
    return <div className={cn("p-6 text-sm text-muted-foreground", props.className)}>{labels.noMounts}</div>;

  return (
    <div ref={rootRef} className={cn("relative flex h-full min-h-0 overflow-hidden rounded-lg border bg-background", props.className)}>
      {split && (
        <aside className="w-56 shrink-0 overflow-auto border-r">
          {shownMounts && (
            <FileTree
              client={client}
              mounts={features.trash
                ? shownMounts
                : shownMounts.map(m => ({ ...m, trash: false }))}
              mount={mount}
              path={path}
              inTrash={inTrash}
              onNavigate={navigate}
              onOpenTrash={m => go(m, "/", true)}
              onDropEntries={dropEntries}
              readOnlyLabel={labels.readOnly}
              trashLabel={labels.trash}
              group={props.sidebar?.group}
              groupLabel={labels.driverGroup}
              manageLabel={labels.manageDrives}
              onManage={() => setDialog({ kind: "manageDrives" })}
            />
          )}
        </aside>
      )}

      <section
        className="flex min-w-0 flex-1 flex-col outline-none"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node) && setDropActive(false)}
        onDrop={onDrop}
        aria-label={currentMount?.label}
      >
        <header className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
          <IconButton label={labels.up} disabled={path === "/"} onClick={() => mount && navigate(mount, dirname(path))}>
            <ArrowUpIcon />
          </IconButton>
          {/* Narrow: the toolbar wraps below the breadcrumb instead of squeezing it. */}
          <Breadcrumb className={cn("min-w-0 flex-1 px-1", narrow && "basis-[calc(100%-2.5rem)]")}>
            <BreadcrumbList className="flex-nowrap overflow-hidden">
              <BreadcrumbItem>
                {!split && shownMounts
                  ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<button type="button" className="flex items-center gap-1 rounded-sm hover:text-foreground" aria-label={labels.storage} />}>
                          <span className="truncate">{currentMount?.label}</span>
                          <ChevronDownIcon className="size-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                          <DropdownMenuRadioGroup
                            value={inTrash
                              ? ""
                              : mount ?? ""}
                            onValueChange={v => navigate(v as string, "/")}
                          >
                            {props.sidebar?.group === "driver"
                              ? groupMountsByDriver(shownMounts).map(g => (
                                  <DropdownMenuGroup key={g.driver}>
                                    <DropdownMenuLabel>{labels.driverGroup(g.driver)}</DropdownMenuLabel>
                                    {g.mounts.map(m => <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>{m.label}</DropdownMenuRadioItem>)}
                                  </DropdownMenuGroup>
                                ))
                              : shownMounts.map(m => <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>{m.label}</DropdownMenuRadioItem>)}
                          </DropdownMenuRadioGroup>
                          {currentMount?.trash && features.trash && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => go(currentMount.id, "/", true)}>
                                <Trash2Icon />
                                {labels.trash}
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setDialog({ kind: "manageDrives" })}>
                            <SettingsIcon />
                            {labels.manageDrives}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )
                  : crumbs.length || inTrash
                    ? <BreadcrumbLink render={<button type="button" onClick={() => mount && navigate(mount, "/")} />}>{currentMount?.label}</BreadcrumbLink>
                    : <BreadcrumbPage>{currentMount?.label}</BreadcrumbPage>}
              </BreadcrumbItem>
              {inTrash && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{labels.trash}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
              {!inTrash && crumbs.map((name, i) => {
                const target = `/${crumbs.slice(0, i + 1).join("/")}`;
                return [
                  <BreadcrumbSeparator key={`s-${target}`} />,
                  <BreadcrumbItem key={target} className="min-w-0">
                    {i === crumbs.length - 1
                      ? <BreadcrumbPage className="truncate">{name}</BreadcrumbPage>
                      : <BreadcrumbLink className="truncate" render={<button type="button" onClick={() => mount && navigate(mount, target)} />}>{name}</BreadcrumbLink>}
                  </BreadcrumbItem>,
                ];
              })}
            </BreadcrumbList>
          </Breadcrumb>

          {inTrash
            ? (
                <Button size="sm" variant="ghost" disabled={trashItems.length === 0} onClick={() => setDialog({ kind: "emptyTrash" })}>
                  <Trash2Icon />
                  {labels.emptyTrash}
                </Button>
              )
            : features.search && (
              <div className={cn("relative flex items-center gap-1", narrow && "order-last basis-full")}>
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  aria-label={labels.search}
                  placeholder={labels.search}
                  className={cn("h-7 pl-7 text-xs md:text-xs", narrow
                    ? "w-full"
                    : "w-48")}
                  value={query}
                  onChange={e => changeQuery(e.target.value)}
                  onKeyDown={e => e.key === "Escape" && changeQuery("")}
                />
                {canQuickOpen && <IconButton label={labels.quickOpen} onClick={() => setQuickOpen(true)}><FileSearchIcon /></IconButton>}
                {query.trim() && (
                  <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={labels.search}>
                    {(["folder", "below"] as const).map(s => (
                      <Button
                        key={s}
                        size="xs"
                        variant={searchScope === s
                          ? "secondary"
                          : "ghost"}
                        aria-pressed={searchScope === s}
                        onClick={() => setSearchScope(s)}
                      >
                        {s === "folder"
                          ? labels.searchHere
                          : labels.searchBelow}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}

          {inTrash
            ? null
            : selected.length > 0
              ? (
                  <div className="flex items-center gap-1" role="toolbar" aria-label={labels.selected(selected.length)}>
                    <span className="px-2 text-xs text-muted-foreground">{labels.selected(selected.length)}</span>
                    {features.download && <IconButton label={labels.download} onClick={() => download(selected)}><DownloadIcon /></IconButton>}
                    {selected.every(s => s.caps.copy) && <IconButton label={labels.copy} onClick={() => copyToClipboard("copy", selected)}><CopyIcon /></IconButton>}
                    {selected.every(s => s.caps.move) && <IconButton label={labels.cut} onClick={() => copyToClipboard("cut", selected)}><ScissorsIcon /></IconButton>}
                    {selected.length === 1 && selected[0]!.caps.rename && <IconButton label={labels.rename} onClick={() => setDialog({ kind: "rename", entry: selected[0]! })}><PencilIcon /></IconButton>}
                    {selected.every(s => s.caps.delete) && (
                      <IconButton
                        label={labels.delete}
                        onClick={() => requestDelete(selected.map(s => s.path))}
                      >
                        <Trash2Icon />
                      </IconButton>
                    )}
                    <IconButton label={labels.cancel} onClick={() => setRawSelection(EMPTY_SELECTION)}><XIcon /></IconButton>
                  </div>
                )
              : (
                  <div className="flex items-center gap-1" role="toolbar">
                    {canPaste && (
                      <Button size="sm" variant="ghost" onClick={paste}>
                        <ClipboardPasteIcon />
                        {labels.paste}
                      </Button>
                    )}
                    {canMkdir && <IconButton label={labels.newFolder} onClick={() => setDialog({ kind: "mkdir" })}><FolderPlusIcon /></IconButton>}
                    {canNewFile && <IconButton label={labels.newFile} onClick={() => setDialog({ kind: "newFile" })}><FilePlusIcon /></IconButton>}
                    {canUpload && (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<IconButton label={labels.upload} />}><UploadIcon /></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                            <UploadIcon />
                            {labels.upload}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
                            <FolderUpIcon />
                            {labels.uploadFolder}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <DropdownMenu>
                      {narrow
                        ? <DropdownMenuTrigger render={<IconButton label={labels.sortBy} />}><ArrowUpDownIcon /></DropdownMenuTrigger>
                        : <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>{labels.sortBy}</DropdownMenuTrigger>}
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuRadioGroup value={sort.key} onValueChange={v => setSort(s => ({ ...s, key: v as FmSortKey }))}>
                          <DropdownMenuRadioItem value="name">{labels.name}</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="mtime">{labels.modified}</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="size">{labels.size}</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuRadioGroup value={sort.order} onValueChange={v => setSort(s => ({ ...s, order: v as "asc" | "desc" }))}>
                          <DropdownMenuRadioItem value="asc">{labels.ascending}</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="desc">{labels.descending}</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <IconButton
                      label={view === "list"
                        ? labels.gridView
                        : labels.listView}
                      onClick={() => setView(view === "list"
                        ? "grid"
                        : "list")}
                    >
                      {view === "list"
                        ? <LayoutGridIcon />
                        : <ListIcon />}
                    </IconButton>
                    <IconButton
                      label={labels.refresh}
                      onClick={() => void qc.invalidateQueries({
                        queryKey: fmKeys.all(client),
                      })}
                    >
                      <RefreshCwIcon />
                    </IconButton>
                  </div>
                )}
          {!narrow && (
            <IconButton label={split ? labels.hideSidebar : labels.showSidebar} aria-pressed={split} onClick={() => setLayout(split ? "single" : "split")}>
              <PanelLeftIcon />
            </IconButton>
          )}
          {!inTrash && features.details && (
            <IconButton label={labels.details} aria-pressed={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
              <InfoIcon />
            </IconButton>
          )}
        </header>

        {shownError && (
          <div role="alert" className="flex items-center gap-2 border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <span className="flex-1">{shownError}</span>
            <IconButton size="icon-xs" label={labels.close} onClick={() => setError(undefined)}><XIcon /></IconButton>
          </div>
        )}

        {below && search.data?.truncated && (
          <div className="border-b px-3 py-1 text-xs text-muted-foreground">{labels.searchTruncated}</div>
        )}

        {inTrash && mount
          ? (
              <TrashView
                mount={mount}
                mountLabel={currentMount?.label ?? mount}
                client={client}
                labels={labels}
                onError={setError}
                onRestored={n => n > 0 && setNotice({ message: labels.restored })}
              />
            )
          : (
              <ContextMenu>
                <ContextMenuTrigger
                  render={<div className="flex min-h-0 flex-1 flex-col" />}
                  onContextMenu={(e) => {
                    if (!(e.target as HTMLElement).closest("[data-path]"))
                      setRawSelection(EMPTY_SELECTION);
                  }}
                >
                  <FileList
                    compact={narrow}
                    entries={entries}
                    view={view}
                    selection={selection}
                    labels={labels}
                    client={client}
                    sort={sort.key}
                    order={sort.order}
                    onSort={key => setSort(s => ({
                      key,
                      order: s.key === key && s.order === "asc"
                        ? "desc"
                        : "asc",
                    }))}
                    onSelect={onSelect}
                    onClearSelection={() => setRawSelection(EMPTY_SELECTION)}
                    onOpen={openEntry}
                    onEntryContextMenu={e => !selection.paths.has(e.path) && setRawSelection({
                      paths: new Set([e.path]),
                      anchor: e.path,
                    })}
                    onDropOnFolder={(paths, folder) => runOps({
                      op: "move",
                      paths,
                      dest: folder.path,
                      conflict: "rename",
                    })}
                    showParent={below}
                    hasMore={!below && !!listing.hasNextPage && !listing.isFetchingNextPage}
                    onLoadMore={() => void listing.fetchNextPage()}
                    disabled={pick && (e => e.kind === "file" && !acceptsEntry(e, pick.accept))}
                    empty={(
                      <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
                        {(below
                          ? search.isPending
                          : listing.isPending)
                          ? labels.loading
                          : (query.trim()
                              ? labels.noMatches
                              : labels.emptyFolder)}
                      </div>
                    )}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  {selected.length
                    ? entryMenu(selected)
                    : blankMenu()}
                </ContextMenuContent>
              </ContextMenu>
            )}

        {dropActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/5 ring-2 ring-primary ring-inset">
            <span className="rounded-md bg-background px-3 py-1.5 text-sm shadow">{labels.dropHere}</span>
          </div>
        )}

        {pick && (() => {
          const total = selected.reduce((n, e) => n + e.size, 0);
          const over = pick.maxTotalSize !== undefined && total > pick.maxTotalSize;
          return (
            <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-sm" data-fm-pick-bar="">
              <span>{labels.selected(selected.length)}</span>
              <span className="text-muted-foreground tabular-nums">{labels.pickTotal(formatSize(total))}</span>
              {over && <span role="alert" className="text-destructive">{labels.pickOverLimit(formatSize(pick.maxTotalSize!))}</span>}
              <span className="flex-1" />
              {pick.onCancel && <Button size="sm" variant="ghost" onClick={pick.onCancel}>{labels.cancel}</Button>}
              <Button size="sm" disabled={selected.length === 0 || over} onClick={() => pick.onPick(selected)}>{labels.confirm}</Button>
            </footer>
          );
        })()}
      </section>

      {detailsOpen && features.details && !inTrash && (selected.length === 1
        ? selected[0]
        : dir) && (
        <DetailsPanel
          key={(selected.length === 1
            ? selected[0]
            : dir)!.path}
          entry={(selected.length === 1
            ? selected[0]
            : dir)!}
          mountLabel={currentMount?.label ?? ""}
          client={client}
          labels={labels}
          overlay={narrow}
          onClose={() => setDetailsOpen(false)}
        />
      )}

      <input ref={fileInputRef} type="file" multiple hidden onChange={onPick} />
      <input ref={folderInputRef} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={onPick} />

      <UploadPanel queue={queue} labels={labels} />

      {notice && (
        <div role="status" className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground py-1.5 pr-1.5 pl-4 text-sm text-background shadow-lg">
          <span>{notice.message}</span>
          {notice.undo && (
            <Button size="sm" variant="ghost" className="text-background hover:bg-background/15 hover:text-background" onClick={notice.undo}>
              {labels.undo}
            </Button>
          )}
          <IconButton size="icon-xs" label={labels.close} className="text-background hover:bg-background/15 hover:text-background" onClick={() => setNotice(undefined)}><XIcon /></IconButton>
        </div>
      )}

      {preview && (
        <PreviewDialog
          entry={preview}
          siblings={entries.filter(e => e.kind === "file")}
          client={client}
          labels={labels}
          editable={features.edit}
          previewers={pluginPreviewers}
          onNavigate={setPreview}
          {...(features.download
            ? {
                onDownload: (e: FmEntry) => download([e]),
              }
            : {})}
          onClose={() => setPreview(undefined)}
        />
      )}

      {canQuickOpen && (
        <QuickOpen
          client={client}
          mount={mount}
          labels={labels}
          open={quickOpen}
          onOpenChange={setQuickOpen}
          onPick={pickQuickOpen}
        />
      )}

      {dialog?.kind === "mkdir" && mount && (
        <NameDialog
          title={labels.newFolder}
          initial={labels.newFolder}
          submitLabel={labels.create}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onSubmit={(name) => {
            setDialog(undefined);
            mutations.mkdir.mutate(joinPath(path, name), {
              onError: e => setError(e.message),
            });
          }}
        />
      )}
      {dialog?.kind === "newFile" && mount && (
        <NameDialog
          title={labels.newFile}
          initial={labels.untitled}
          submitLabel={labels.create}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onSubmit={(name) => {
            setDialog(undefined);
            client.write(mount, joinPath(path, name), "", { conflict: "fail" }).then((e) => {
              void mutations.invalidate();
              setPreview(e);
            }, (e: Error) => setError(e.message));
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title={labels.rename}
          initial={dialog.entry.name}
          submitLabel={labels.rename}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onSubmit={(name) => {
            setDialog(undefined);
            if (name !== basename(dialog.entry.path))
              runOps({ op: "rename", path: dialog.entry.path, name });
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          count={dialog.paths.length}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onConfirm={() => {
            setDialog(undefined);
            runOps({ op: "delete", paths: dialog.paths }, () => setRawSelection(EMPTY_SELECTION));
          }}
        />
      )}
      {dialog?.kind === "emptyTrash" && mount && (
        <ConfirmDeleteDialog
          count={trashItems.length}
          title={labels.confirmEmptyTrash}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onConfirm={() => {
            setDialog(undefined);
            mutations.purge.mutate(undefined, {
              onSuccess: res => setError(failedMessage(res.results)),
              onError: e => setError(e.message),
            });
          }}
        />
      )}
      {dialog?.kind === "manageDrives" && mounts.data && (
        <ManageDrivesDialog
          mounts={visibleMounts(mounts.data, hostHidden, [], undefined)}
          hidden={userHidden}
          current={mount}
          labels={labels}
          onChange={setUserHidden}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === "uploadConflict" && mount && (
        <UploadConflictDialog
          count={dialog.clashes.size}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onChoose={(choice) => {
            const { files, clashes } = dialog;
            setDialog(undefined);
            const clash = (f: FmUploadFile) => clashes.has(topName(f)) && !(f.relativePath ?? "").includes("/");
            queue.getState().enqueue(mount, path, choice === "skip"
              ? files.filter(f => !clash(f))
              : files.map(f => (clash(f)
                  ? { ...f, conflict: choice }
                  : f)));
          }}
        />
      )}
    </div>
  );
}
