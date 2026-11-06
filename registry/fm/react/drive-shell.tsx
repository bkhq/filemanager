import type { FmSortKey } from "../core/schema";
import type { FileManagerProps } from "./file-manager";
import type { FmController } from "./use-file-manager";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  CopyIcon,
  DownloadIcon,
  FilePlusIcon,
  FilterIcon,
  FolderPlusIcon,
  FolderUpIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  ScissorsIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { dirname } from "../core/path";
import { DetailsPanel } from "./details-panel";
import { FilterChips, FilterMenuItems } from "./filter-menu";
import { hasFilters } from "./filters";
import { IconButton } from "./icon-button";
import { ManagerList } from "./manager-list";
import { ManagerTree } from "./manager-tree";
import { EMPTY_SELECTION, formatSize } from "./state";
import { TrashView } from "./trash-view";

/**
 * Drive layout: the folder tree (folders only) on the left, the chosen folder on the right,
 * files open in the preview dialog; a batch bar acts on the selection.
 */
export function DriveShell({ props, fm }: { props: FileManagerProps; fm: FmController }) {
  const {
    client,
    labels,
    features,
    storageKey,
    mount,
    path,
    inTrash,
    narrow,
    stacked,
    treeOnly,
    setNarrowPane,
    guard,
    query,
    searchScope,
    setSearchScope,
    view,
    setView,
    sort,
    setSort,
    filters,
    changeFilters,
    selected,
    setRawSelection,
    detailsOpen,
    setDetailsOpen,
    setDialog,
    setError,
    setNotice,
    shownError,
    below,
    search,
    currentMount,
    trashItems,
    navigate,
    changeQuery,
    download,
    copyToClipboard,
    requestDelete,
    runAction,
    pickFiles,
    fileInputRef,
    folderInputRef,
    canMkdir,
    canNewFile,
    canUpload,
    dir,
    dropzone,
    onKeyDown,
    columns,
    columnValues,
    shownMounts,
  } = fm;
  const actions = [
    ...(props.actions ?? []),
    ...(props.plugins ?? []).flatMap(p => p.actions ?? []),
  ].filter(a => !a.when || a.when(selected));
  const crumbs = path === "/"
    ? []
    : path.slice(1).split("/");
  const detailsEntry = detailsOpen && features.details && !inTrash
    ? (selected.length === 1
        ? selected[0]
        : dir)
    : undefined;
  const sideDetails = !!detailsEntry && !narrow;
  const panes = useDefaultLayout({
    id: `${storageKey}:drive:panels`,
    panelIds: [
      ...(stacked
        ? []
        : ["tree"]),
      "main",
      ...(sideDetails
        ? ["details"]
        : []),
    ],
    ...(typeof localStorage !== "undefined"
      ? { storage: localStorage }
      : {}),
  });
  // On narrow containers choosing a folder in the tree shows its contents.
  const quota = currentMount?.quota;
  const tree = (
    <>
      <ManagerTree
        props={props}
        fm={fm}
        group={shownMounts?.some(m => m.group !== undefined)
          ? "space"
          : undefined}
        onNavigate={(m, p) => {
          navigate(m, p);
          setNarrowPane("main");
        }}
      />
      {quota && (
        <div className="grid gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground" data-fm-quota="">
          {quota.total !== undefined && <Progress value={Math.min(100, quota.used / quota.total * 100)} aria-label={currentMount.label} />}
          <span>
            {quota.total === undefined
              ? labels.quotaUsedOnly(formatSize(quota.used))
              : labels.quotaUsed(formatSize(quota.used), formatSize(quota.total))}
          </span>
        </div>
      )}
    </>
  );

  return (
    <>
      <ResizablePanelGroup id={`${storageKey}:drive:panels`} orientation="horizontal" className="min-w-0 flex-1" defaultLayout={panes.defaultLayout} onLayoutChanged={panes.onLayoutChanged}>
        {!stacked && (
          <ResizablePanel id="tree" defaultSize="240px" minSize="160px" maxSize="40%" className="flex flex-col">
            {tree}
          </ResizablePanel>
        )}
        {!stacked && <ResizableHandle withHandle aria-label={labels.resizeTree} />}

        <ResizablePanel id="main" minSize="320px">
          <section
            {...dropzone.getRootProps({
              "className": "relative flex h-full min-w-0 flex-col outline-none",
              "tabIndex": 0,
              "inert": treeOnly,
              "role": "region",
              "aria-label": currentMount?.label,
              "aria-disabled": undefined,
            })}
            onKeyDown={onKeyDown}
          >
            <header className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
              {stacked && (
                <IconButton label={labels.backToTree} onClick={() => guard(() => setNarrowPane("tree"))}>
                  <ArrowLeftIcon />
                </IconButton>
              )}
              <IconButton label={labels.up} disabled={path === "/" || inTrash} onClick={() => mount && navigate(mount, dirname(path))}>
                <ArrowUpIcon />
              </IconButton>
              <Breadcrumb className={cn("min-w-0 flex-1 px-1", narrow && "basis-[calc(100%-5rem)]")}>
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

              {inTrash && (
                <Button size="sm" variant="ghost" disabled={trashItems.length === 0} onClick={() => setDialog({ kind: "emptyTrash" })}>
                  <Trash2Icon />
                  {labels.emptyTrash}
                </Button>
              )}
              {!inTrash && features.search && (
                <div className={cn("relative flex items-center gap-1", narrow && "order-last basis-full")}>
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    aria-label={labels.search}
                    placeholder={labels.search}
                    className={cn("h-7 pl-7 text-xs md:text-xs", narrow
                      ? "w-full"
                      : "w-56")}
                    value={query}
                    onChange={e => changeQuery(e.target.value)}
                    onKeyDown={e => e.key === "Escape" && changeQuery("")}
                  />
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
              {!inTrash && (
                <>
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
                  {features.details && (
                    <IconButton label={labels.details} aria-pressed={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
                      <InfoIcon />
                    </IconButton>
                  )}
                  {(canMkdir || canNewFile) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button size="sm" />}>
                        <PlusIcon />
                        {labels.newMenu}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        {canMkdir && (
                          <DropdownMenuItem onClick={() => setDialog({ kind: "mkdir" })}>
                            <FolderPlusIcon />
                            {labels.newFolder}
                          </DropdownMenuItem>
                        )}
                        {canNewFile && (
                          <DropdownMenuItem onClick={() => setDialog({ kind: "newFile" })}>
                            <FilePlusIcon />
                            {labels.newFile}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {canUpload && (
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
                        <UploadIcon />
                        {labels.uploadMenu}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => pickFiles(fileInputRef.current)}>
                          <UploadIcon />
                          {labels.upload}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => pickFiles(folderInputRef.current)}>
                          <FolderUpIcon />
                          {labels.uploadFolder}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              )}
            </header>

            {!inTrash && (selected.length > 0
              ? (
                  <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-1" role="toolbar" aria-label={labels.selected(selected.length)}>
                    <IconButton label={labels.cancel} onClick={() => setRawSelection(EMPTY_SELECTION)}><XIcon /></IconButton>
                    <span className="px-1 text-sm">{labels.selected(selected.length)}</span>
                    <span className="flex-1" />
                    {features.download && <IconButton label={labels.download} onClick={() => download(selected)}><DownloadIcon /></IconButton>}
                    {selected.every(s => s.caps.copy) && <IconButton label={labels.copy} onClick={() => copyToClipboard("copy", selected)}><CopyIcon /></IconButton>}
                    {selected.every(s => s.caps.move) && <IconButton label={labels.cut} onClick={() => copyToClipboard("cut", selected)}><ScissorsIcon /></IconButton>}
                    {selected.length === 1 && selected[0]!.caps.rename && <IconButton label={labels.rename} onClick={() => setDialog({ kind: "rename", entry: selected[0]! })}><PencilIcon /></IconButton>}
                    {actions.map(a => <IconButton key={a.id} label={a.label} onClick={() => runAction(a, selected)}>{a.icon}</IconButton>)}
                    {selected.every(s => s.caps.delete) && <IconButton label={labels.delete} onClick={() => requestDelete(selected.map(s => s.path))}><Trash2Icon /></IconButton>}
                  </div>
                )
              : (
                  <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" aria-pressed={hasFilters(filters)} />}>
                        <FilterIcon />
                        {labels.filter}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        <FilterMenuItems filters={filters} onChange={changeFilters} labels={labels} columns={columns} values={columnValues} />
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
                        <ArrowUpDownIcon />
                        {labels.sortBy}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-40">
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
                    <FilterChips filters={filters} onChange={changeFilters} labels={labels} columns={columns} className="border-0 p-0" />
                  </div>
                ))}

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
                    retentionDays={currentMount?.trashRetentionDays}
                    client={client}
                    labels={labels}
                    onError={setError}
                    onRestored={n => n > 0 && setNotice({ message: labels.restored })}
                  />
                )
              : <ManagerList fm={fm} />}

            {dropzone.isDragActive && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/5 ring-2 ring-primary ring-inset">
                <span className="rounded-md bg-background px-3 py-1.5 text-sm shadow">{labels.dropHere}</span>
              </div>
            )}
          </section>
        </ResizablePanel>

        {sideDetails && detailsEntry && <ResizableHandle withHandle aria-label={labels.resizeDetails} />}
        {sideDetails && detailsEntry && (
          <ResizablePanel id="details" defaultSize="288px" minSize="220px" maxSize="50%">
            <DetailsPanel
              key={detailsEntry.path}
              entry={detailsEntry}
              mountLabel={currentMount?.label ?? ""}
              client={client}
              labels={labels}
              overlay={false}
              columns={props.columns}
              tabs={props.detailTabs}
              onClose={() => setDetailsOpen(false)}
            />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>

      {treeOnly && <div className="absolute inset-0 z-10 flex flex-col bg-background">{tree}</div>}

      {detailsEntry && narrow && (
        <DetailsPanel
          key={detailsEntry.path}
          entry={detailsEntry}
          mountLabel={currentMount?.label ?? ""}
          client={client}
          labels={labels}
          overlay
          columns={props.columns}
          tabs={props.detailTabs}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </>
  );
}
