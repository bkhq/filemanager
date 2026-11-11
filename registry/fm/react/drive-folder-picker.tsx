import type { FmClient } from "../client/client";
import type { FmEntry, FmMountInfo } from "../core/schema";
import type { FmLabels } from "./labels";
import { FolderIcon } from "lucide-react";
import { useState } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useListing } from "../client/hooks";
import { dirname, isWithin } from "../core/path";

/** Chooses a folder in any writable space to move or copy `entries` into. */
export function DriveFolderPicker({ mode, entries, from, mounts, client, labels, onPick, onClose }: {
  mode: "move" | "copy";
  entries: readonly FmEntry[];
  /** Mount of `entries`. */
  from: string;
  mounts: readonly FmMountInfo[];
  client: FmClient;
  labels: FmLabels;
  onPick: (to: { mount: string; path: string }) => void;
  onClose: () => void;
}) {
  const writable = mounts.filter(m => m.caps.write);
  const [at, setAt] = useState({
    mount: writable.some(m => m.id === from)
      ? from
      : writable[0]?.id ?? from,
    path: "/",
  });
  const listing = useListing(client, at.mount, at.path, "name", "asc", "", { hidden: false });
  const folders = (listing.data?.pages.flatMap(p => p.items) ?? []).filter(e => e.kind === "dir");
  const crumbs = at.path === "/"
    ? []
    : at.path.slice(1).split("/");
  const same = at.mount === from;
  // Not into a moved folder, nor (moving) back into the folder they are in.
  const blocked = same && entries.some(e => isWithin(at.path, e.path) || (mode === "move" && dirname(e.path) === at.path));
  const title = mode === "move"
    ? labels.moveTo
    : labels.copyTo;

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ToggleGroup
          size="sm"
          spacing={1}
          className="flex-wrap"
          aria-label={labels.storage}
          value={[at.mount]}
          onValueChange={v => v[0] && setAt({ mount: v[0] as string, path: "/" })}
        >
          {writable.map(m => <ToggleGroupItem key={m.id} value={m.id} className="text-xs">{m.label}</ToggleGroupItem>)}
        </ToggleGroup>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {crumbs.length
                ? <BreadcrumbLink render={<button type="button" onClick={() => setAt({ ...at, path: "/" })} />}>{writable.find(m => m.id === at.mount)?.label}</BreadcrumbLink>
                : <BreadcrumbPage>{writable.find(m => m.id === at.mount)?.label}</BreadcrumbPage>}
            </BreadcrumbItem>
            {crumbs.map((name, i) => {
              const target = `/${crumbs.slice(0, i + 1).join("/")}`;
              return [
                <BreadcrumbSeparator key={`s-${target}`} />,
                <BreadcrumbItem key={target}>
                  {i === crumbs.length - 1
                    ? <BreadcrumbPage>{name}</BreadcrumbPage>
                    : <BreadcrumbLink render={<button type="button" onClick={() => setAt({ ...at, path: target })} />}>{name}</BreadcrumbLink>}
                </BreadcrumbItem>,
              ];
            })}
          </BreadcrumbList>
        </Breadcrumb>
        <ScrollArea className="h-64 rounded-md border">
          <ul aria-label={title} className="p-1">
            {folders.map(f => (
              <li key={f.path}>
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                  disabled={same && entries.some(e => isWithin(f.path, e.path))}
                  onClick={() => setAt({ ...at, path: f.path })}
                >
                  <FolderIcon className="size-4 shrink-0 text-sky-500" />
                  <span className="truncate">{f.name}</span>
                </button>
              </li>
            ))}
            {!listing.isPending && folders.length === 0 && <li className="p-2 text-sm text-muted-foreground">{labels.emptyFolder}</li>}
          </ul>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{labels.cancel}</Button>
          <Button disabled={blocked} onClick={() => onPick(at)}>
            {mode === "move"
              ? labels.moveHere
              : labels.copyHere}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
