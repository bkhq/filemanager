import type { PreviewProps } from "../react/previewers";
import { code } from "@streamdown/code";
import { BookOpenIcon, Columns2Icon, FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useDefaultLayout } from "react-resizable-panels";
import { Streamdown } from "streamdown";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconButton } from "../react/icon-button";
import { LazyTextPreview } from "../react/previewers";

const MAX_BYTES = 2 * 1024 * 1024;

type Mode = "source" | "preview" | "side";

/** Rendered Markdown of `text`; follows the editor live. */
function Rendered({ text }: { text: string }) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-4 text-sm wrap-break-word">
      <Streamdown mode="static" plugins={{ code }}>{text}</Streamdown>
    </article>
  );
}

/**
 * Opens in the text editor like any text file. Header buttons show the rendered
 * Markdown instead of the editor or beside it; the preview follows the editor's
 * text, unsaved edits included. The editor stays mounted so drafts survive.
 */
export function MarkdownPreview(props: PreviewProps) {
  const { entry, labels, actions } = props;
  const [mode, setMode] = useState<Mode>("source");
  const [text, setText] = useState("");
  const panes = useDefaultLayout({
    id: "fm-markdown:panels",
    panelIds: mode === "source"
      ? ["editor"]
      : ["editor", "preview"],
    ...(typeof localStorage !== "undefined"
      ? { storage: localStorage }
      : {}),
  });

  if (entry.size > MAX_BYTES)
    return <LazyTextPreview {...props} />;

  const editorShown = mode !== "preview";
  return (
    // Panels size by flex-grow: the editor hidden in preview mode leaves the preview the whole row.
    // The panel element has an inline `display`, so hiding it needs `!important`.
    <ResizablePanelGroup id="fm-markdown:panels" orientation="horizontal" className="min-h-0 [&>[data-fm-hidden]]:hidden!" defaultLayout={panes.defaultLayout} onLayoutChanged={panes.onLayoutChanged}>
      {actions && createPortal(
        <>
          {mode === "preview"
            ? <IconButton label={labels.reopenSource} onClick={() => setMode("source")}><FileCodeIcon /></IconButton>
            : <IconButton label={labels.openPreview} onClick={() => setMode("preview")}><BookOpenIcon /></IconButton>}
          <IconButton
            label={labels.openPreviewToSide}
            aria-pressed={mode === "side"}
            onClick={() => setMode(mode === "side"
              ? "source"
              : "side")}
          >
            <Columns2Icon />
          </IconButton>
        </>,
        actions,
      )}
      <ResizablePanel
        id="editor"
        minSize="20%"
        className="min-w-0"
        data-fm-hidden={editorShown
          ? undefined
          : ""}
      >
        <LazyTextPreview
          {...props}
          // The Save button belongs in the header only while the editor is visible.
          actions={editorShown
            ? (actions ?? null)
            : null}
          onTextChange={setText}
        />
      </ResizablePanel>
      {mode === "side" && <ResizableHandle withHandle aria-label={labels.resizePanes} />}
      {mode !== "source" && (
        <ResizablePanel id="preview" minSize="20%" className="min-w-0">
          <ScrollArea className="h-full" data-fm-markdown-preview="">
            <Rendered text={text} />
          </ScrollArea>
        </ResizablePanel>
      )}
    </ResizablePanelGroup>
  );
}
