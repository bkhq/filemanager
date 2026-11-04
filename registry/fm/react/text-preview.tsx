import type { Extension } from "@codemirror/state";
import type { PreviewProps } from "./previewers";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { useQuery } from "@tanstack/react-query";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { DownloadIcon, LockIcon, SaveIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { FmApiError } from "../client/client";
import { fmKeys, useFileText, useFmMutations } from "../client/hooks";
import { IconButton } from "./icon-button";
import { MAX_TEXT_BYTES } from "./previewers";

function useLanguage(name: string): Extension[] {
  const [ext, setExt] = useState<Extension[]>([]);
  useEffect(() => {
    let alive = true;
    const desc = LanguageDescription.matchFilename(languages, name);
    void desc?.load().then(support => alive && setExt([support]));
    return () => {
      alive = false;
    };
  }, [name]);
  return ext;
}

const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

/** Text / code viewer; editable with optimistic concurrency when the entry allows writes. */
export function TextPreview({ entry, client, labels, actions, onDirtyChange }: PreviewProps) {
  // Files above the limit load only their head through a Range request and stay read-only.
  const truncated = entry.size > MAX_TEXT_BYTES;
  const full = useFileText(client, entry.mount, entry.path, !truncated);
  const head = useQuery({
    queryKey: [
      ...fmKeys.all(client),
      "text-head",
      entry.mount,
      entry.path,
      entry.etag,
    ],
    queryFn: async () => {
      const res = await fetch(client.readUrl(entry.mount, entry.path), {
        headers: {
          ...client.headers(),
          range: `bytes=0-${MAX_TEXT_BYTES - 1}`,
        },
      });
      if (!res.ok)
        throw new FmApiError(res.status, "HTTP_ERROR", res.statusText);
      // A server ignoring Range answers 200 with the whole file.
      return new TextDecoder().decode((await res.arrayBuffer()).slice(0, MAX_TEXT_BYTES));
    },
    enabled: truncated,
    staleTime: 0,
  });
  const query = truncated ? head : full;
  const editable = entry.caps.write && !truncated;
  const { save } = useFmMutations(client, entry.mount);
  const language = useLanguage(entry.name);
  const [draft, setDraft] = useState<string | undefined>();
  const [etag, setEtag] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const base = full.data;
  const text = draft ?? (truncated ? head.data : base?.text) ?? "";
  const dirty = draft !== undefined && draft !== base?.text;
  const conflict = save.error instanceof FmApiError && save.error.status === 412;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const onSave = () => {
    save.mutate({ path: entry.path, text, etag: etag ?? base!.etag }, {
      onSuccess: (e) => {
        setEtag(e.etag);
        setDraft(undefined);
        setSaved(true);
      },
    });
  };

  const reload = async () => {
    save.reset();
    setDraft(undefined);
    setEtag(undefined);
    await full.refetch();
  };

  if (query.isPending)
    return <div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>;
  if (query.isError)
    return <div className="p-4 text-sm text-destructive">{query.error.message}</div>;

  return (
    <div className="flex h-full flex-col">
      {!editable && actions && createPortal(
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <LockIcon className="size-3.5" />
          {labels.readOnly}
        </span>,
        actions,
      )}
      {editable && actions && createPortal(
        <>
          {saved && !dirty && <span className="text-xs text-muted-foreground">{labels.saved}</span>}
          <IconButton label={labels.save} disabled={!dirty || save.isPending} onClick={onSave}><SaveIcon /></IconButton>
        </>,
        actions,
      )}
      {truncated && (
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          {labels.largeFile(MAX_TEXT_BYTES / 1024 / 1024)}
          <Button size="sm" variant="outline" render={<a href={client.readUrl(entry.mount, entry.path, { download: true })} download={entry.name} />}>
            <DownloadIcon />
            {labels.download}
          </Button>
        </div>
      )}
      {(conflict || save.isError) && (
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-destructive">
          {conflict
            ? (
                <>
                  {labels.conflict}
                  <Button size="sm" variant="outline" onClick={() => void reload()}>{labels.reload}</Button>
                </>
              )
            : save.error?.message}
        </div>
      )}
      <CodeMirror
        className="min-h-0 flex-1 overflow-auto text-sm"
        height="100%"
        value={text}
        theme={isDark()
          ? "dark"
          : "light"}
        readOnly={!editable}
        extensions={[...language, EditorView.lineWrapping]}
        onChange={(v) => {
          setSaved(false);
          setDraft(v);
        }}
      />
    </div>
  );
}
