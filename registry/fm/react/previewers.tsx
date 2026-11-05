import type { FmClient } from "../client/client";
import type { FmEntry } from "../core/schema";
import type { FmLabels } from "./labels";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { fmKeys } from "../client/hooks";
import { MediaStage } from "./media-stage";
import { kindOf, looksBinary } from "./state";

export interface PreviewProps {
  entry: FmEntry;
  client: FmClient;
  labels: FmLabels;
  /** Slot in the preview header; portal toolbar actions into it. */
  actions?: HTMLElement | null;
  /** Editors report unsaved changes so closing or navigating can ask first. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Editors report their current text, unsaved edits included (e.g. for a live preview). */
  onTextChange?: (text: string) => void;
}

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const TextPreview = lazy(() => import("./text-preview").then(m => ({ default: m.TextPreview })));

/** Image types the browser can re-encode when rotation / flip are saved. */
const SAVABLE = ["image/png", "image/jpeg", "image/webp"];

/** Fits the image; zoom, rotate and flip from the header, a click toggles actual size. Writable PNG / JPEG / WebP can save rotation and flip. */
export function ImagePreview({ entry, client, labels, actions }: PreviewProps) {
  const qc = useQueryClient();
  const onSave = entry.caps.write && entry.mime && SAVABLE.includes(entry.mime)
    ? async (image: Blob) => {
      await client.write(entry.mount, entry.path, image, { ifMatch: entry.etag });
      await qc.invalidateQueries({
        queryKey: fmKeys.lists(client, entry.mount),
      });
    }
    : undefined;
  return (
    <MediaStage
      // A saved image starts over from its new orientation.
      key={entry.etag}
      kind="image"
      src={client.readUrl(entry.mount, entry.path, { version: entry.etag })}
      alt={entry.name}
      labels={labels}
      actions={actions}
      mime={entry.mime}
      onSave={onSave}
    />
  );
}

export function MediaPreview({ entry, client, labels, actions }: PreviewProps) {
  const src = client.readUrl(entry.mount, entry.path, { version: entry.etag });
  if (kindOf(entry) === "video")
    return <MediaStage kind="video" src={src} alt={entry.name} labels={labels} actions={actions} />;
  return (
    <div className="flex h-full items-center justify-center bg-black/90 p-4">
      <audio src={src} controls className="w-full max-w-lg" />
    </div>
  );
}

export function PdfPreview({ entry, client }: PreviewProps) {
  return <iframe title={entry.name} src={`${client.readUrl(entry.mount, entry.path, { version: entry.etag })}#toolbar=0&navpanes=0`} className="size-full border-0" />;
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
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">{props.labels.loading}</div>}>
      <TextPreview {...props} />
    </Suspense>
  );
}

const SNIFF_BYTES = 8192;

/** Reads the first bytes of an unknown file: text opens in the editor, binary falls back to download. */
export function SniffPreview(props: PreviewProps) {
  const { entry, client, labels } = props;
  const binary = useQuery({
    queryKey: [
      "fm",
      client.baseUrl,
      "sniff",
      entry.mount,
      entry.path,
      entry.etag,
    ],
    queryFn: async () => {
      const res = await client.read(entry.mount, entry.path, {
        version: entry.etag,
        range: { start: 0, end: SNIFF_BYTES - 1 },
      });
      return looksBinary(new Uint8Array(await res.arrayBuffer()).subarray(0, SNIFF_BYTES));
    },
  });

  if (binary.isPending)
    return <div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>;
  if (binary.isError || binary.data)
    return <FallbackPreview {...props} />;
  return <LazyTextPreview {...props} />;
}
