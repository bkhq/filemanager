import type { FileManagerProps } from "./file-manager";
import type { FmController } from "./use-file-manager";
import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  FilePlusIcon,
  FilterIcon,
  FolderPlusIcon,
  InfoIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { dirname } from "../core/path";
import { FilterChips, FilterMenuItems } from "./filter-menu";
import { hasFilters } from "./filters";
import { IconButton } from "./icon-button";
import { ManagerList } from "./manager-list";
import { shellDetailsEntry } from "./manager-shared";
import { ManagerTree } from "./manager-tree";
import {
  EmptyTrashButton,
  FloatingSelectionBar,
  ShellBreadcrumb,
  ShellDetails,
  ShellDropSection,
  ShellNotices,
  ShellSearch,
  ShellTrash,
  SortMenuItems,
  UploadMenuItems,
  ViewToggle,
} from "./shell-parts";
import { formatSize } from "./state";

/**
 * Drive layout: the folder tree (folders only) on the left, the chosen folder on the right,
 * files open in the preview dialog; a batch bar acts on the selection.
 */
export function DriveShell({ props, fm }: { props: FileManagerProps; fm: FmController }) {
  const {
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
    filters,
    changeFilters,
    selected,
    detailsOpen,
    setDetailsOpen,
    setDialog,
    currentMount,
    navigate,
    canMkdir,
    canNewFile,
    canUpload,
    columns,
    columnValues,
    shownMounts,
  } = fm;
  const actions = [
    ...(props.actions ?? []),
    ...(props.plugins ?? []).flatMap(p => p.actions ?? []),
  ].filter(a => !a.when || a.when(selected));
  const detailsEntry = shellDetailsEntry(fm);
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
          <ShellDropSection fm={fm}>
            <header className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
              {stacked && (
                <IconButton label={labels.backToTree} onClick={() => guard(() => setNarrowPane("tree"))}>
                  <ArrowLeftIcon />
                </IconButton>
              )}
              <IconButton label={labels.up} disabled={path === "/" || inTrash} onClick={() => mount && navigate(mount, dirname(path))}>
                <ArrowUpIcon />
              </IconButton>
              <ShellBreadcrumb fm={fm} className={narrow ? "basis-[calc(100%-5rem)]" : undefined} />

              {inTrash && (
                <EmptyTrashButton fm={fm} />
              )}
              {!inTrash && (
                <>
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
                        <UploadMenuItems fm={fm} />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </>
              )}
            </header>

            {!inTrash && (
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
                    <SortMenuItems fm={fm} />
                  </DropdownMenuContent>
                </DropdownMenu>
                <FilterChips filters={filters} onChange={changeFilters} labels={labels} columns={columns} className="border-0 p-0" />
                <span className="flex-1" />
                {features.search && (
                  <ShellSearch fm={fm} width="w-72" />
                )}
                <ViewToggle fm={fm} />
                {features.details && (
                  <IconButton label={labels.details} aria-pressed={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
                    <InfoIcon />
                  </IconButton>
                )}
              </div>
            )}

            <ShellNotices fm={fm} />

            {inTrash && mount
              ? (
                  <ShellTrash fm={fm} mount={mount} />
                )
              : <ManagerList fm={fm} roomy />}

            {!inTrash && selected.length > 0 && <FloatingSelectionBar fm={fm} actions={actions} />}

          </ShellDropSection>
        </ResizablePanel>

        {sideDetails && detailsEntry && <ResizableHandle withHandle aria-label={labels.resizeDetails} />}
        {sideDetails && detailsEntry && (
          <ResizablePanel id="details" defaultSize="288px" minSize="220px" maxSize="50%">
            <ShellDetails fm={fm} props={props} entry={detailsEntry} overlay={false} />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>

      {treeOnly && <div className="absolute inset-0 z-10 flex flex-col bg-background">{tree}</div>}

      {detailsEntry && narrow && (
        <ShellDetails fm={fm} props={props} entry={detailsEntry} overlay />
      )}
    </>
  );
}
