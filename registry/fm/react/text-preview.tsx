import type { Extension } from "@codemirror/state";
import type { PreviewProps } from "./previewers";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { useQuery } from "@tanstack/react-query";
import CodeMirror, { EditorView, keymap, Prec } from "@uiw/react-codemirror";
import { DownloadIcon, LockIcon, MoreHorizontalIcon, SaveIcon, WrapTextIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FmApiError } from "../client/client";
import { fmKeys, useFileText, useFmMutations } from "../client/hooks";
import { clearDraft, loadDraft, saveDraft } from "./drafts";
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

const WRAP_KEY = "fm:wrap";
const DRAFT_DELAY = 300;

const isDark = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

/** Follows the host's `.dark` class on <html>, so the editor switches with the page theme. */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/** Read-only highlighted text, e.g. a file inside an archive; the language follows `name`. */
export function CodeView({ name, text }: { name: string; text: string }) {
  const language = useLanguage(name);
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  const extensions = useMemo(() => [...language, EditorView.lineWrapping], [language]);
  return (
    <ScrollArea className="h-full">
      <CodeMirror
        className="text-sm"
        minHeight="100%"
        value={text}
        theme={dark
          ? "dark"
          : "light"}
        readOnly
        editable={false}
        extensions={extensions}
      />
    </ScrollArea>
  );
}

/** Text / code viewer; editable with optimistic concurrency when the entry allows writes. */
export function TextPreview({ entry, client, labels, actions, onDirtyChange, onTextChange }: PreviewProps) {
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
    queryFn: async () => (await client.readText(entry.mount, entry.path, {
      range: { start: 0, end: MAX_TEXT_BYTES - 1 },
    })).text,
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
  // A restored draft based on an older version of the file.
  const [stale, setStale] = useState(false);
  const [wrap, setWrap] = useState(() => typeof localStorage === "undefined" || localStorage.getItem(WRAP_KEY) !== "off");

  const base = full.data;
  const text = draft ?? (truncated ? head.data : base?.text) ?? "";
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  useEffect(() => {
    onTextChange?.(text);
  }, [text, onTextChange]);
  const dirty = draft !== undefined && draft !== base?.text;
  const conflict = stale || (save.error instanceof FmApiError && save.error.status === 412);
  const baseEtag = etag ?? base?.etag;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const restoredForRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = `${entry.mount}:${entry.path}`;
    if (!editable || !base || restoredForRef.current === key)
      return;
    restoredForRef.current = key;
    const stored = loadDraft(entry.mount, entry.path);
    if (stored && stored.text !== base.text) {
      setDraft(stored.text);
      setEtag(stored.etag);
      setStale(stored.etag !== base.etag);
    }
  }, [
    editable,
    base,
    entry.mount,
    entry.path,
  ]);

  // Debounced draft write; flushed on unmount and pagehide.
  const pendingDraftRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    pendingDraftRef.current = undefined;
    if (!editable || draft === undefined || !base)
      return;
    if (draft === base.text) {
      clearDraft(entry.mount, entry.path);
      return;
    }
    const write = () => {
      pendingDraftRef.current = undefined;
      saveDraft(entry.mount, entry.path, { text: draft, etag: baseEtag ?? "" });
    };
    pendingDraftRef.current = write;
    const timer = setTimeout(write, DRAFT_DELAY);
    return () => clearTimeout(timer);
  }, [
    editable,
    draft,
    base,
    baseEtag,
    entry.mount,
    entry.path,
  ]);
  useEffect(() => {
    const flush = () => pendingDraftRef.current?.();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const write = (ifMatch: string) => {
    save.mutate({ path: entry.path, text, etag: ifMatch }, {
      onSuccess: (e) => {
        pendingDraftRef.current = undefined;
        clearDraft(entry.mount, entry.path);
        setEtag(e.etag);
        setDraft(undefined);
        setStale(false);
        setSaved(true);
      },
    });
  };
  const onSave = () => {
    if (editable && dirty && !save.isPending)
      write(baseEtag!);
  };
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const saveKeymap = useMemo(() => Prec.high(keymap.of([
    {
      key: "Mod-s",
      run: () => {
        saveRef.current();
        return true;
      },
    },
  ])), []);

  const discard = () => {
    pendingDraftRef.current = undefined;
    clearDraft(entry.mount, entry.path);
    save.reset();
    setDraft(undefined);
    setEtag(undefined);
    setStale(false);
  };

  const reload = async () => {
    discard();
    await full.refetch();
  };

  const keepEditing = () => {
    save.reset();
    setStale(false);
  };

  const toggleWrap = () => {
    const next = !wrap;
    setWrap(next);
    if (typeof localStorage !== "undefined")
      localStorage.setItem(WRAP_KEY, next ? "on" : "off");
  };

  const extensions = useMemo(
    () => [
      ...language,
      saveKeymap,
      ...(wrap
        ? [EditorView.lineWrapping]
        : []),
    ],
    [language, saveKeymap, wrap],
  );

  if (query.isPending)
    return <div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>;
  if (query.isError)
    return <div className="p-4 text-sm text-destructive">{query.error.message}</div>;

  const wrapButton = <IconButton label={labels.wordWrap} aria-pressed={wrap} onClick={toggleWrap}><WrapTextIcon /></IconButton>;

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "s" || e.defaultPrevented)
          return;
        // Never let the browser's save dialog open; the editor keymap may already have saved.
        e.preventDefault();
        onSave();
      }}
    >
      {!editable && actions && createPortal(
        <>
          {wrapButton}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <LockIcon className="size-3.5" />
            {labels.readOnly}
          </span>
        </>,
        actions,
      )}
      {editable && actions && createPortal(
        <>
          {wrapButton}
          {dirty
            ? <span className="text-xs text-muted-foreground">{labels.unsaved}</span>
            : saved && <span className="text-xs text-muted-foreground">{labels.saved}</span>}
          {dirty && (
            <>
              <IconButton label={labels.save} disabled={save.isPending} onClick={onSave}><SaveIcon /></IconButton>
              <DropdownMenu>
                <DropdownMenuTrigger render={<IconButton label={labels.more} />}><MoreHorizontalIcon /></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={discard}>{labels.discardEdits}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
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
      {editable && (conflict || save.isError) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs text-destructive">
          {conflict
            ? (
                <>
                  {labels.conflict}
                  <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => write("")}>{labels.overwrite}</Button>
                  <Button size="sm" variant="outline" onClick={() => void reload()}>{labels.reloadFromDisk}</Button>
                  <Button size="sm" variant="ghost" onClick={keepEditing}>{labels.keepEditing}</Button>
                </>
              )
            : save.error?.message}
        </div>
      )}
      {/* The editor grows with its text and the ScrollArea scrolls it (long lines scroll inside the editor). */}
      <ScrollArea className="min-h-0 flex-1">
        <CodeMirror
          className="text-sm"
          minHeight="100%"
          value={text}
          theme={dark
            ? "dark"
            : "light"}
          readOnly={!editable}
          extensions={extensions}
          onChange={(v) => {
            setSaved(false);
            setDraft(v);
          }}
        />
      </ScrollArea>
    </div>
  );
}
