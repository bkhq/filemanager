import type { PreviewProps } from "../react/previewers";
import type { FmArchiveNode } from "./archive-tree";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import { ChevronRightIcon, DownloadIcon, FolderIcon, LockIcon, SearchIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EntryIcon } from "../react/file-list";
import { FallbackPreview } from "../react/previewers";
import { viewportRef } from "../react/scroll";
import { formatSize, kindOf } from "../react/state";
import { archiveRows, buildArchiveTree } from "./archive-tree";

// CodeMirror and the language data load with the first text entry.
const CodeView = lazy(() => import("../react/text-preview").then(m => ({ default: m.CodeView })));

const ROW_H = 28;
/** Entries carry no MIME type; images are recognised by extension. */
const IMAGE = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico)$/i;
/** Text entries larger than this are offered for download only. */
const MAX_TEXT = 1024 * 1024;

/** Inline view of one archive entry: image, text or a download button. */
function EntryPreview({ node, props }: { node: FmArchiveNode; props: PreviewProps }) {
  const { entry, client, labels } = props;
  const kind = IMAGE.test(node.name)
    ? "image"
    : kindOf({ kind: "file", name: node.name });
  const src = client.zipEntryUrl(entry.mount, entry.path, node.path);
  const text = useQuery({
    queryKey: [
      "fm",
      client.baseUrl,
      "zip-entry",
      entry.mount,
      entry.path,
      entry.etag,
      node.path,
    ],
    enabled: kind === "text" && node.size <= MAX_TEXT && !node.entry?.encrypted,
    queryFn: async () => (await fetch(src)).text(),
  });
  const download = (
    <Button size="sm" variant="outline" render={<a href={client.zipEntryUrl(entry.mount, entry.path, node.path, { download: true })} download={node.name} />}>
      <DownloadIcon />
      {labels.download}
    </Button>
  );
  if (node.entry?.encrypted)
    return <div className="p-4 text-sm text-muted-foreground">{labels.archiveEncrypted}</div>;
  if (kind === "image") {
    return (
      <div className="flex h-full items-center justify-center bg-muted/30 p-4">
        <img src={src} alt={node.name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }
  if (kind === "text" && node.size <= MAX_TEXT) {
    return text.isPending
      ? <div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>
      : (
          <div data-fm-archive-text="" className="h-full">
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>}>
              <CodeView name={node.name} text={text.data ?? text.error?.message ?? ""} />
            </Suspense>
          </div>
        );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
      <p>{labels.noPreview}</p>
      {download}
    </div>
  );
}

/** Folder tree of a zip archive (read from its central directory) with an inline preview of the selected file. */
export function ArchivePreview(props: PreviewProps) {
  const { entry, client, labels } = props;
  const listing = useQuery({
    queryKey: [
      "fm",
      client.baseUrl,
      "zip",
      entry.mount,
      entry.path,
      entry.etag,
    ],
    queryFn: () => client.zipEntries(entry.mount, entry.path),
  });
  const tree = useMemo(() => buildArchiveTree(listing.data?.entries ?? []), [listing.data]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<FmArchiveNode>();
  const panes = useDefaultLayout({
    id: "fm-archive:panels",
    panelIds: ["tree", "entry"],
    ...(typeof localStorage !== "undefined"
      ? { storage: localStorage }
      : {}),
  });
  const rows = useMemo(() => archiveRows(tree, open, filter), [tree, open, filter]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });

  if (listing.isPending)
    return <div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>;
  if (listing.isError)
    return <FallbackPreview {...props} message={listing.error.message} />;

  const toggle = (path: string) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(path))
      next.delete(path);
    else
      next.add(path);
    return next;
  });

  return (
    <ResizablePanelGroup id="fm-archive:panels" orientation="horizontal" className="min-h-0" defaultLayout={panes.defaultLayout} onLayoutChanged={panes.onLayoutChanged}>
      <ResizablePanel id="tree" defaultSize="50%" minSize="20%" className="flex min-w-0 flex-col">
        <div className="relative border-b p-1.5">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label={labels.archiveFilter} placeholder={labels.archiveFilter} className="h-7 pl-7 text-xs md:text-xs" value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <ScrollArea className="min-h-0 flex-1" ref={viewportRef(scrollRef)}>
          <div className="p-1 text-sm">
            <div
              role="tree"
              aria-label={entry.name}
              className="relative"
              style={{
                height: virtualizer.getTotalSize(),
              }}
            >
              {virtualizer.getVirtualItems().map((v) => {
                const { node, depth } = rows[v.index]!;
                const isOpen = !!filter.trim() || open.has(node.path);
                return (
                  <div
                    key={node.path}
                    role="treeitem"
                    aria-label={node.name}
                    aria-level={depth + 1}
                    aria-expanded={node.dir ? isOpen : undefined}
                    aria-selected={selected?.path === node.path}
                    className="absolute inset-x-0 top-0"
                    style={{ height: ROW_H, transform: `translateY(${v.start}px)`, paddingLeft: depth * 16 }}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn("w-full justify-start font-normal", selected?.path === node.path && "bg-accent text-accent-foreground hover:bg-accent")}
                      onClick={() => (node.dir
                        ? toggle(node.path)
                        : setSelected(node))}
                    >
                      {node.dir
                        ? (
                            <>
                              <ChevronRightIcon className={cn("transition-transform", isOpen && "rotate-90")} />
                              <FolderIcon className="text-sky-500" />
                            </>
                          )
                        : <EntryIcon entry={{ kind: "file", name: node.name }} />}
                      <span className="truncate">{node.name}</span>
                      {node.entry?.encrypted && <LockIcon className="text-muted-foreground" />}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatSize(node.size)}</span>
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </ScrollArea>
        <div className="border-t px-2 py-1 text-xs text-muted-foreground">
          {labels.archiveSummary(listing.data.entries.filter(e => !e.dir).length, tree.size)}
          {listing.data.truncated && ` · ${labels.archiveTruncated}`}
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label={labels.resizePanes} />
      <ResizablePanel id="entry" minSize="20%" className="min-w-0">
        {selected
          ? <EntryPreview key={selected.path} node={selected} props={props} />
          : <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">{labels.archiveSelect}</div>}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
