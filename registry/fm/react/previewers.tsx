import type { FmClient } from "../client/client";
import type { Entry } from "../core/schema";
import type { Labels } from "./labels";
import { cn } from "cn";
import { DownloadIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { kindOf } from "./state";

export interface PreviewProps {
  entry: Entry;
  client: FmClient;
  labels: Labels;
  /** Slot in the preview header; portal toolbar actions into it. */
  actions?: HTMLElement | null;
  /** Editors report unsaved changes so closing or navigating can ask first. */
  onDirtyChange?: (dirty: boolean) => void;
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const TextPreview = lazy(() => import("./text-preview").then(m => ({ default: m.TextPreview })));

/** Fits the image; a click toggles actual size (scrollable). */
export function ImagePreview({ entry, client }: PreviewProps) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div className="flex h-full overflow-auto bg-muted/30 p-4">
      <img
        src={client.readUrl(entry.mount, entry.path, { version: entry.etag })}
        alt={entry.name}
        className={cn("m-auto", zoomed
          ? "max-w-none cursor-zoom-out"
          : "max-h-full max-w-full cursor-zoom-in object-contain")}
        onClick={() => setZoomed(!zoomed)}
      />
    </div>
  );
}

export function MediaPreview({ entry, client }: PreviewProps) {
  const src = client.readUrl(entry.mount, entry.path, { version: entry.etag });
  return (
    <div className="flex h-full items-center justify-center bg-black/90 p-4">
      {kindOf(entry) === "video"
        ? <video src={src} controls className="max-h-full max-w-full" />
        : <audio src={src} controls className="w-full max-w-lg" />}
    </div>
  );
}

export function PdfPreview({ entry, client }: PreviewProps) {
  return <iframe title={entry.name} src={client.readUrl(entry.mount, entry.path, { version: entry.etag })} className="size-full border-0" />;
}

export function FallbackPreview({ entry, client, labels, message }: PreviewProps & { message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
      <p>{message ?? labels.noPreview}</p>
      <Button variant="outline" render={<a href={client.readUrl(entry.mount, entry.path, { download: true })} download={entry.name} />}>
        <DownloadIcon />
        {labels.download}
      </Button>
    </div>
  );
}

export function LazyTextPreview(props: PreviewProps) {
  if (props.entry.size > MAX_TEXT_BYTES)
    return <FallbackPreview {...props} message={props.labels.tooLargeToPreview} />;
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">{props.labels.loading}</div>}>
      <TextPreview {...props} />
    </Suspense>
  );
}
