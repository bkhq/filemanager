import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from "react";
import type { FmClient } from "../client/client";
import type { UploadFile } from "../client/upload";
import type { Entry, OpsRequest, SortKey } from "../core/schema";
import type { Labels } from "./labels";
import type { Clipboard, Selection, SelectMode } from "./state";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  ArrowUpIcon,
  ClipboardPasteIcon,
  CopyIcon,
  DownloadIcon,
  FolderPlusIcon,
  FolderUpIcon,
  LayoutGridIcon,
  ListIcon,
  PencilIcon,
  RefreshCwIcon,
  ScissorsIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { createElement, useCallback, useMemo, useRef, useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createFmClient } from "../client/client";
import { fmKeys, useFmMutations, useListing, useMounts } from "../client/hooks";
import { createUploadQueue, xhrTransport } from "../client/upload";
import { basename, dirname, joinPath } from "../core/path";
import { ConfirmDeleteDialog, NameDialog } from "./dialogs";
import { filesFromDrop, filesFromInput } from "./drop";
import { FileList } from "./file-list";
import { FileTree } from "./file-tree";
import { enLabels } from "./labels";
import { findPreviewer } from "./preview-registry";
import { EMPTY_SELECTION, prune, select, step } from "./state";
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
}

type DialogState
  = | { kind: "mkdir" }
    | { kind: "rename"; entry: Entry }
    | { kind: "delete"; paths: string[] }
    | undefined;

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
  const [location, setLocation] = useState({ mount: props.initialMount, path: props.initialPath ?? "/" });
  const mount = location.mount ?? mounts.data?.[0]?.id;
  const { path } = location;
  const [view, setView] = useViewMode(props.storageKey ?? "fm:view");
  const [sort, setSort] = useState<{ key: SortKey; order: "asc" | "desc" }>({ key: "name", order: "asc" });
  const [rawSelection, setRawSelection] = useState<Selection>(EMPTY_SELECTION);
  const [clipboard, setClipboard] = useState<Clipboard>();
  const [preview, setPreview] = useState<Entry>();
  const [dialog, setDialog] = useState<DialogState>();
  const [error, setError] = useState<string>();
  const [dropActive, setDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const listing = useListing(client, mount, path, sort.key, sort.order);
  const entries = useMemo(() => listing.data?.pages.flatMap(p => p.items) ?? [], [listing.data]);
  const dir = listing.data?.pages[0]?.entry;
  const order = useMemo(() => entries.map(e => e.path), [entries]);
  const selection = useMemo(() => prune(rawSelection, order), [rawSelection, order]);
  const byPath = useMemo(() => new Map(entries.map(e => [e.path, e])), [entries]);
  const selected = useMemo(() => [...selection.paths].map(p => byPath.get(p)).filter((e): e is Entry => !!e), [selection, byPath]);
  const mutations = useFmMutations(client, mount ?? "");
  const canWrite = !!dir?.caps.write;

  const onUploadedRef = useRef(() => {});
  onUploadedRef.current = () => void mutations.invalidate();
  const [queue] = useState(() => createUploadQueue({
    transport: xhrTransport(client),
    onUploaded: () => onUploadedRef.current(),
  }));

  const shownError = error ?? listing.error?.message;

  const navigate = useCallback((m: string, p: string) => {
    setLocation({ mount: m, path: p });
    setRawSelection(EMPTY_SELECTION);
    setError(undefined);
  }, []);

  const runOps = (req: OpsRequest, after?: () => void) => {
    mutations.ops.mutate(req, {
      onSuccess: (res) => {
        const failed = res.results.filter(r => !r.ok);
        setError(failed.length
          ? `${labels.failed(failed.length)}: ${failed[0]!.error?.message ?? ""}`
          : undefined);
        after?.();
      },
      onError: e => setError(e.message),
    });
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

  const upload = (files: UploadFile[]) => {
    if (mount && files.length)
      queue.getState().enqueue(mount, path, files);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    upload(filesFromInput(e.target.files!));
    e.target.value = "";
  };

  const onSelect = (p: string, mode: SelectMode) => setRawSelection(s => select(s, p, mode, order));

  const onKeyDown = (e: KeyboardEvent) => {
    if (dialog || preview || (e.target as HTMLElement).closest("input, textarea, [contenteditable]"))
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
        if (selected.length && selected.every(x => x.caps.delete)) {
          setDialog({
            kind: "delete",
            paths: selected.map(x => x.path),
          });
        }
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
    if (!canWrite || !e.dataTransfer.types.includes("Files"))
      return;
    e.preventDefault();
    setDropActive(true);
  };
  const onDrop = (e: DragEvent) => {
    setDropActive(false);
    if (!canWrite || !e.dataTransfer.types.includes("Files"))
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
      menuItem("download", labels.download, <DownloadIcon />, () => download(targets)),
      <ContextMenuSeparator key="s1" />,
      menuItem("copy", labels.copy, <CopyIcon />, () => copyToClipboard("copy", targets), {
        show: targets.every(t => t.caps.copy),
      }),
      menuItem("cut", labels.cut, <ScissorsIcon />, () => copyToClipboard("cut", targets), {
        show: targets.every(t => t.caps.move),
      }),
      one && menuItem("rename", labels.rename, <PencilIcon />, () => setDialog({ kind: "rename", entry: one }), { show: one.caps.rename }),
      custom.length > 0 && <ContextMenuSeparator key="s2" />,
      ...custom.map(a => menuItem(`x-${a.id}`, a.label, a.icon, () => a.run(targets))),
      <ContextMenuSeparator key="s3" />,
      menuItem("delete", labels.delete, <Trash2Icon />, () => setDialog({
        kind: "delete",
        paths: targets.map(t => t.path),
      }), {
        show: targets.every(t => t.caps.delete),
        destructive: true,
      }),
    ];
  };

  const blankMenu = () => [
    menuItem("mkdir", labels.newFolder, <FolderPlusIcon />, () => setDialog({ kind: "mkdir" }), { show: canWrite }),
    menuItem("upload", labels.upload, <UploadIcon />, () => fileInputRef.current?.click(), { show: canWrite }),
    menuItem("paste", labels.paste, <ClipboardPasteIcon />, paste, { show: canPaste }),
    menuItem("refresh", labels.refresh, <RefreshCwIcon />, () => void listing.refetch()),
  ];

  const currentMount = mounts.data?.find(m => m.id === mount);
  const crumbs = path === "/"
    ? []
    : path.slice(1).split("/");

  if (mounts.data && mounts.data.length === 0)
    return <div className={cn("p-6 text-sm text-muted-foreground", props.className)}>{labels.noMounts}</div>;

  return (
    <div className={cn("relative flex h-full min-h-0 overflow-hidden rounded-lg border bg-background", props.className)}>
      <aside className="hidden w-56 shrink-0 overflow-auto border-r md:block">
        {mounts.data && <FileTree client={client} mounts={mounts.data} mount={mount} path={path} onNavigate={navigate} readOnlyLabel={labels.readOnly} />}
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
          <Button size="icon-sm" variant="ghost" aria-label={labels.up} disabled={path === "/"} onClick={() => mount && navigate(mount, dirname(path))}>
            <ArrowUpIcon />
          </Button>
          <Breadcrumb className="min-w-0 flex-1 px-1">
            <BreadcrumbList className="flex-nowrap overflow-hidden">
              <BreadcrumbItem>
                {crumbs.length
                  ? <BreadcrumbLink render={<button type="button" onClick={() => mount && navigate(mount, "/")} />}>{currentMount?.label}</BreadcrumbLink>
                  : <BreadcrumbPage>{currentMount?.label}</BreadcrumbPage>}
              </BreadcrumbItem>
              {crumbs.map((name, i) => {
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

          {selected.length > 0
            ? (
                <div className="flex items-center gap-1" role="toolbar" aria-label={labels.selected(selected.length)}>
                  <span className="px-2 text-xs text-muted-foreground">{labels.selected(selected.length)}</span>
                  <Button size="icon-sm" variant="ghost" aria-label={labels.download} onClick={() => download(selected)}><DownloadIcon /></Button>
                  {selected.every(s => s.caps.copy) && <Button size="icon-sm" variant="ghost" aria-label={labels.copy} onClick={() => copyToClipboard("copy", selected)}><CopyIcon /></Button>}
                  {selected.every(s => s.caps.move) && <Button size="icon-sm" variant="ghost" aria-label={labels.cut} onClick={() => copyToClipboard("cut", selected)}><ScissorsIcon /></Button>}
                  {selected.length === 1 && selected[0]!.caps.rename && <Button size="icon-sm" variant="ghost" aria-label={labels.rename} onClick={() => setDialog({ kind: "rename", entry: selected[0]! })}><PencilIcon /></Button>}
                  {selected.every(s => s.caps.delete) && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={labels.delete}
                      onClick={() => setDialog({
                        kind: "delete",
                        paths: selected.map(s => s.path),
                      })}
                    >
                      <Trash2Icon />
                    </Button>
                  )}
                  <Button size="icon-sm" variant="ghost" aria-label={labels.cancel} onClick={() => setRawSelection(EMPTY_SELECTION)}><XIcon /></Button>
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
                  {canWrite && <Button size="icon-sm" variant="ghost" aria-label={labels.newFolder} onClick={() => setDialog({ kind: "mkdir" })}><FolderPlusIcon /></Button>}
                  {canWrite && (
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={labels.upload} />}><UploadIcon /></DropdownMenuTrigger>
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
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={view === "list"
                      ? labels.gridView
                      : labels.listView}
                    onClick={() => setView(view === "list"
                      ? "grid"
                      : "list")}
                  >
                    {view === "list"
                      ? <LayoutGridIcon />
                      : <ListIcon />}
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={labels.refresh}
                    onClick={() => void qc.invalidateQueries({
                      queryKey: fmKeys.all(client),
                    })}
                  >
                    <RefreshCwIcon />
                  </Button>
                </div>
              )}
        </header>

        {shownError && (
          <div role="alert" className="flex items-center gap-2 border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            <span className="flex-1">{shownError}</span>
            <Button size="icon-xs" variant="ghost" aria-label={labels.close} onClick={() => setError(undefined)}><XIcon /></Button>
          </div>
        )}

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
                  {listing.isPending ? labels.loading : labels.emptyFolder}
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

        {dropActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/5 ring-2 ring-primary ring-inset">
            <span className="rounded-md bg-background px-3 py-1.5 text-sm shadow">{labels.dropHere}</span>
          </div>
        )}
      </section>

      <input ref={fileInputRef} type="file" multiple hidden onChange={onPick} />
      <input ref={folderInputRef} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={onPick} />

      <UploadPanel queue={queue} labels={labels} />

      {preview && (
        <Dialog open onOpenChange={o => !o && setPreview(undefined)}>
          <DialogContent className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-5xl">
            <DialogHeader className="flex-row items-center gap-2 border-b py-2 pr-12 pl-4">
              <DialogTitle className="min-w-0 flex-1 truncate">{preview.name}</DialogTitle>
              <Button size="icon-sm" variant="ghost" aria-label={labels.download} onClick={() => download([preview])}><DownloadIcon /></Button>
            </DialogHeader>
            <div className="min-h-0 flex-1">
              {createElement(findPreviewer(preview), {
                key: preview.path,
                entry: preview,
                client,
                labels,
              })}
            </div>
          </DialogContent>
        </Dialog>
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
    </div>
  );
}
