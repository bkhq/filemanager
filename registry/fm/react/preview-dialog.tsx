import type { KeyboardEvent } from "react";
import type { FmClient } from "../client/client";
import type { FmEntry } from "../core/schema";
import type { FmLabels } from "./labels";
import type { FmPreviewer } from "./preview-registry";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import { createElement, Suspense, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconButton } from "./icon-button";
import { findPreviewer } from "./preview-registry";

/** Preview of `entry` with previous / next over `siblings` and a guard against losing unsaved edits. */
export function PreviewDialog({ entry, siblings, client, labels, editable, previewers, onNavigate, onDownload, onClose }: {
  entry: FmEntry;
  /** Files in display order. */
  siblings: FmEntry[];
  client: FmClient;
  labels: FmLabels;
  editable: boolean;
  /** Plugin previewers, considered next to the registered ones. */
  previewers?: readonly FmPreviewer[];
  onNavigate: (entry: FmEntry) => void;
  /** Omit to hide the download button. */
  onDownload?: (entry: FmEntry) => void;
  onClose: () => void;
}) {
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<() => void>();

  const guard = (fn: () => void) => (dirty
    ? setPending(() => fn)
    : fn());
  const index = siblings.findIndex(s => s.path === entry.path);
  const prev = index > 0
    ? siblings[index - 1]
    : undefined;
  const next = index >= 0
    ? siblings[index + 1]
    : undefined;
  const go = (target: FmEntry | undefined) => target && guard(() => onNavigate(target));

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]"))
      return;
    if (e.key === "ArrowLeft")
      go(prev);
    else if (e.key === "ArrowRight")
      go(next);
  };

  const shown = editable
    ? entry
    : {
        ...entry,
        caps: { ...entry.caps, write: false },
      };

  return (
    <>
      <Dialog open onOpenChange={o => !o && guard(onClose)}>
        <DialogContent className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-5xl" onKeyDown={onKeyDown}>
          <DialogHeader className="flex-row items-center gap-2 border-b py-2 pr-12 pl-4">
            <DialogTitle className="min-w-0 flex-1 truncate">{entry.name}</DialogTitle>
            <div ref={setActions} className="flex items-center gap-2" />
            {onDownload && <IconButton label={labels.download} onClick={() => onDownload(entry)}><DownloadIcon /></IconButton>}
            {siblings.length > 1 && (
              <>
                <IconButton label={labels.previous} disabled={!prev} onClick={() => go(prev)}><ChevronLeftIcon /></IconButton>
                <IconButton label={labels.next} disabled={!next} onClick={() => go(next)}><ChevronRightIcon /></IconButton>
              </>
            )}
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>}>
              {createElement(findPreviewer(entry, previewers), {
                key: entry.path,
                entry: shown,
                client,
                labels,
                actions,
                onDirtyChange: setDirty,
              })}
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>
      {pending && (
        <AlertDialog open onOpenChange={o => !o && setPending(undefined)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{labels.discardChanges}</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  setPending(undefined);
                  setDirty(false);
                  pending();
                }}
              >
                {labels.discard}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
