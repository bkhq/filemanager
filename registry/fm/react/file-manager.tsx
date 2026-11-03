import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from "react";
import type { FmClient } from "../client/client";
import type { UploadFile } from "../client/upload";
import type { Entry, OpsRequest, SortKey } from "../core/schema";
import type { Features } from "./features";
import type { Labels } from "./labels";
import type { Clipboard, Selection, SelectMode } from "./state";
import type { Undo } from "./undo";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  ArrowUpIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  DownloadIcon,
  FilePlusIcon,
  FolderPlusIcon,
  FolderUpIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  PencilIcon,
  RefreshCwIcon,
  ScissorsIcon,
  SearchIcon,
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
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { createFmClient } from "../client/client";
import { fmKeys, useFmMutations, useListing, useMounts, useTrash } from "../client/hooks";
import { createUploadQueue, xhrTransport } from "../client/upload";
import { basename, dirname, joinPath } from "../core/path";
import { DetailsPanel } from "./details-panel";
import { ConfirmDeleteDialog, NameDialog, UploadConflictDialog } from "./dialogs";
import { filesFromDrop, filesFromInput } from "./drop";
import { maskEntry, resolveFeatures } from "./features";
import { FileList } from "./file-list";
import { FileTree } from "./file-tree";
import { IconButton } from "./icon-button";
import { enLabels } from "./labels";
import { PreviewDialog } from "./preview-dialog";
import { EMPTY_SELECTION, prune, select, step } from "./state";
import { TrashView } from "./trash-view";
import { undoFor } from "./undo";
import { UploadPanel } from "./upload-panel";

export interface FileAction {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown only when this returns true for the targeted entries. */
  when?: (entries: Entry[]) => boolean;
  run: (entries: Entry[]) => void;
}

export interface FileManagerProps {
  /** Router base URL (e.g. `/api/fm`); ignored when `client` is given. */
  baseUrl?: string;
  client?: FmClient;
  labels?: Labels;
  initialMount?: string;
  initialPath?: string;
  /** Extra actions for the entry context menu (share, attach …). */
  actions?: FileAction[];
  className?: string;
  /** localStorage key for the list / grid preference. */
  storageKey?: string;
  /** View-only preset: browse, preview, search and download. */
  readOnly?: boolean;
  /** Per-feature switches applied on top of `readOnly`, e.g. `{ delete: false }`. */
  features?: Partial<Features>;
}

type DialogState
  = | { kind: "mkdir" }
    | { kind: "rename"; entry: Entry }
    | { kind: "delete"; paths: string[] }
    | { kind: "newFile" }
    | { kind: "emptyTrash" }
    | { kind: "uploadConflict"; files: UploadFile[]; clashes: Set<string> }
    | undefined;

/** First path segment of an upload below the target folder. */
const topName = (f: UploadFile) => (f.relativePath || f.file.name).replace(/^\/+/, "").split("/")[0]!;

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
}

function useViewMode(key: string) {
  const [view, setView] = useState<"list" | "grid">(() =>
    (typeof localStorage !== "undefined" && localStorage.getItem(key) === "grid"
      ? "grid"
      : "list"));
  const change = (v: "list" | "grid") => {
    setView(v);
    localStorage.setItem(key, v);
  };
  return [view, change] as const;
}

export function FileManager(props: FileManagerProps) {
  const labels = props.labels ?? enLabels;
  const [client] = useState(() => props.client ?? createFmClient({ baseUrl: props.baseUrl ?? "/api/fm" }));
  const qc = useQueryClient();
  const mounts = useMounts(client);
  const features = useMemo(() => resolveFeatures(props.readOnly, props.features), [props.readOnly, props.features]);
  const [location, setLocation] = useState({ mount: props.initialMount, path: props.initialPath ?? "/", trash: false });
  const mount = location.mount ?? mounts.data?.[0]?.id;
  const { path, trash: inTrash } = location;
  const [query, setQuery] = useState("");
  const [view, setView] = useViewMode(props.storageKey ?? "fm:view");
  const [sort, setSort] = useState<{ key: SortKey; order: "asc" | "desc" }>({ key: "name", order: "asc" });
  const [rawSelection, setRawSelection] = useState<Selection>(EMPTY_SELECTION);
  const [clipboard, setClipboard] = useState<Clipboard>();
  const [preview, setPreview] = useState<Entry>();
  const [dialog, setDialog] = useState<DialogState>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<{ message: string; undo?: () => void }>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const listing = useListing(client, mount, path, sort.key, sort.order, query.trim());
  const entries = useMemo(() => listing.data?.pages.flatMap(p => p.items.map(e => maskEntry(e, features))) ?? [], [listing.data, features]);
  const rawDir = listing.data?.pages[0]?.entry;
  const dir = useMemo(() => rawDir && maskEntry(rawDir, features), [rawDir, features]);
  const order = useMemo(() => entries.map(e => e.path), [entries]);
  const selection = useMemo(() => prune(rawSelection, order), [rawSelection, order]);
  const byPath = useMemo(() => new Map(entries.map(e => [e.path, e])), [entries]);
  const selected = useMemo(() => [...selection.paths].map(p => byPath.get(p)).filter((e): e is Entry => !!e), [selection, byPath]);
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

  const shownError = error ?? listing.error?.message;
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
    setError(undefined);
  }, []);
  const navigate = useCallback((m: string, p: string) => go(m, p, false), [go]);

  const failedMessage = (results: { ok: boolean; error?: { message: string } | undefined }[]) => {
    const failed = results.filter(r => !r.ok);
    return failed.length
      ? `${labels.failed(failed.length)}: ${failed[0]!.error?.message ?? ""}`
      : undefined;
  };

  const runUndo = async (m: string, undo: Undo) => {
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

  const doneMessage = (req: OpsRequest, n: number) => {
    switch (req.op) {
      case "delete": return labels.movedToTrash(n);
      case "rename": return labels.renamed;
      case "move": return labels.movedItems(n);
      default: return labels.copiedItems(n);
    }
  };

  const runOps = (req: OpsRequest, after?: () => void) => {
    const m = mount;
    mutations.ops.mutate(req, {
      onSuccess: (res) => {
        setError(failedMessage(res.results));
        const undo = m && undoFor(req, res.results);
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

  const open = (e: Entry) => (e.kind === "dir"
    ? navigate(e.mount, e.path)
    : setPreview(e));

  const download = (targets: Entry[]) => {
    if (!mount || targets.length === 0)
      return;
    const only = targets[0]!;
    triggerDownload(targets.length === 1 && only.kind === "file"
      ? client.readUrl(mount, only.path, { download: true })
      : client.archiveUrl(mount, targets.map(t => t.path)));
  };

  const copyToClipboard = (mode: Clipboard["mode"], targets: Entry[]) => {
    if (mount && targets.length) {
      setClipboard({
        mode,
        mount,
        paths: targets.map(t => t.path),
      });
    }
  };

  const canPaste = !!clipboard && clipboard.mount === mount && canWrite;
  const paste = () => {
    if (!clipboard || !canPaste)
      return;
    runOps({
      op: clipboard.mode === "cut"
        ? "move"
        : "copy",
      paths: clipboard.paths,
      dest: path,
      conflict: "rename",
    }, () => {
      if (clipboard.mode === "cut")
        setClipboard(undefined);
    });
  };

  const upload = async (files: UploadFile[]) => {
    if (!mount || files.length === 0)
      return;
    const names = [
      ...new Set(files.map(topName)),
    ];
    // The loaded listing is complete unless it is filtered or paged; otherwise ask the server.
    const existing = !query.trim() && !listing.hasNextPage
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

  const onSelect = (p: string, mode: SelectMode) => setRawSelection(s => select(s, p, mode, order));

  const onKeyDown = (e: KeyboardEvent) => {
    if (inTrash || dialog || preview || (e.target as HTMLElement).closest("input, textarea, [contenteditable]"))
      return;
    const mod = e.metaKey || e.ctrlKey;
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
        if (one)
          open(one);
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

  const entryMenu = (targets: Entry[]) => {
    const one = targets.length === 1
      ? targets[0]
      : undefined;
    const custom = (props.actions ?? []).filter(a => !a.when || a.when(targets));
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
      one && menuItem("details", labels.details, <InfoIcon />, () => setDetailsOpen(true), { show: features.details }),
      custom.length > 0 && <ContextMenuSeparator key="s2" />,
      ...custom.map(a => menuItem(`x-${a.id}`, a.label, a.icon, () => a.run(targets))),
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
    <div className={cn("relative flex h-full min-h-0 overflow-hidden rounded-lg border bg-background", props.className)}>
      <aside className="hidden w-56 shrink-0 overflow-auto border-r md:block">
        {mounts.data && (
          <FileTree
            client={client}
            mounts={features.trash
              ? mounts.data
              : mounts.data.map(m => ({ ...m, trash: false }))}
            mount={mount}
            path={path}
            inTrash={inTrash}
            onNavigate={navigate}
            onOpenTrash={m => go(m, "/", true)}
            readOnlyLabel={labels.readOnly}
            trashLabel={labels.trash}
          />
        )}
      </aside>

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
          <Breadcrumb className="min-w-0 flex-1 px-1">
            <BreadcrumbList className="flex-nowrap overflow-hidden">
              <BreadcrumbItem>
                {crumbs.length || inTrash
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
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  aria-label={labels.search}
                  placeholder={labels.search}
                  className="h-7 w-48 pl-7 text-xs md:text-xs"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === "Escape" && setQuery("")}
                />
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
                      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>{labels.sortBy}</DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuRadioGroup value={sort.key} onValueChange={v => setSort(s => ({ ...s, key: v as SortKey }))}>
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
                    onOpen={open}
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
                    hasMore={!!listing.hasNextPage && !listing.isFetchingNextPage}
                    onLoadMore={() => void listing.fetchNextPage()}
                    empty={(
                      <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
                        {listing.isPending
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
          onNavigate={setPreview}
          {...(features.download
            ? {
                onDownload: (e: Entry) => download([e]),
              }
            : {})}
          onClose={() => setPreview(undefined)}
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
      {dialog?.kind === "uploadConflict" && mount && (
        <UploadConflictDialog
          count={dialog.clashes.size}
          labels={labels}
          onClose={() => setDialog(undefined)}
          onChoose={(choice) => {
            const { files, clashes } = dialog;
            setDialog(undefined);
            const clash = (f: UploadFile) => clashes.has(topName(f)) && !(f.relativePath ?? "").includes("/");
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
