import type { Extension } from "@codemirror/state";
import type { PreviewProps } from "./previewers";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { LockIcon, SaveIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { FmApiError } from "../client/client";
import { useFileText, useFmMutations } from "../client/hooks";
import { IconButton } from "./icon-button";

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
export function TextPreview({ entry, client, labels, actions }: PreviewProps) {
  const query = useFileText(client, entry.mount, entry.path);
  const { save } = useFmMutations(client, entry.mount);
  const language = useLanguage(entry.name);
  const [draft, setDraft] = useState<string | undefined>();
  const [etag, setEtag] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const base = query.data;
  const text = draft ?? base?.text ?? "";
  const dirty = draft !== undefined && draft !== base?.text;
  const conflict = save.error instanceof FmApiError && save.error.status === 412;

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
    await query.refetch();
  };

  if (query.isPending)
    return <div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>;
  if (query.isError)
    return <div className="p-4 text-sm text-destructive">{query.error.message}</div>;

  return (
    <div className="flex h-full flex-col">
      {!entry.caps.write && actions && createPortal(
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <LockIcon className="size-3.5" />
          {labels.readOnly}
        </span>,
        actions,
      )}
      {entry.caps.write && actions && createPortal(
        <>
          {saved && !dirty && <span className="text-xs text-muted-foreground">{labels.saved}</span>}
          <IconButton label={labels.save} disabled={!dirty || save.isPending} onClick={onSave}><SaveIcon /></IconButton>
        </>,
        actions,
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
        readOnly={!entry.caps.write}
        extensions={[...language, EditorView.lineWrapping]}
        onChange={(v) => {
          setSaved(false);
          setDraft(v);
        }}
      />
    </div>
  );
}
