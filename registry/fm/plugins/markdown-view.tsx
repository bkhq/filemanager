import type { Components } from "react-markdown";
import type { PreviewProps } from "../react/previewers";
import { cn } from "cn";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { useFileText } from "../client/hooks";
import { LazyTextPreview } from "../react/previewers";

const MAX_BYTES = 2 * 1024 * 1024;

/** Highlighted HTML, or undefined for an unknown language. Shiki and its grammars load on first use. */
async function highlight(code: string, lang: string): Promise<string | undefined> {
  const { bundledLanguages, codeToHtml } = await import("shiki");
  if (!(lang in bundledLanguages))
    return undefined;
  return codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}

const PRE = "overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed";

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<{ key: string; html: string }>();
  const key = `${lang}\n${code}`;
  useEffect(() => {
    if (!lang)
      return;
    let alive = true;
    void highlight(code, lang).then(h => alive && h !== undefined && setHtml({ key: `${lang}\n${code}`, html: h }));
    return () => {
      alive = false;
    };
  }, [code, lang]);

  if (html?.key === key) {
    return (
      <div
        className={cn(
          "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-relaxed",
          "[&_.shiki]:bg-(--shiki-light-bg) [&_.shiki_span]:text-(--shiki-light) dark:[&_.shiki]:bg-(--shiki-dark-bg) dark:[&_.shiki_span]:text-(--shiki-dark)",
        )}
        // Shiki escapes the source; the output is its own markup only.
        // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml
        dangerouslySetInnerHTML={{ __html: html.html }}
      />
    );
  }
  return <pre className={PRE}><code>{code}</code></pre>;
}

const components: Components = {
  h1: ({ node: _, ...p }) => <h1 className="mt-6 mb-3 border-b pb-1 text-2xl font-semibold first:mt-0" {...p} />,
  h2: ({ node: _, ...p }) => <h2 className="mt-6 mb-3 border-b pb-1 text-xl font-semibold first:mt-0" {...p} />,
  h3: ({ node: _, ...p }) => <h3 className="mt-5 mb-2 text-lg font-semibold first:mt-0" {...p} />,
  h4: ({ node: _, ...p }) => <h4 className="mt-4 mb-2 font-semibold first:mt-0" {...p} />,
  h5: ({ node: _, ...p }) => <h5 className="mt-4 mb-2 text-sm font-semibold first:mt-0" {...p} />,
  h6: ({ node: _, ...p }) => <h6 className="mt-4 mb-2 text-sm font-semibold text-muted-foreground first:mt-0" {...p} />,
  p: ({ node: _, ...p }) => <p className="my-3 leading-relaxed" {...p} />,
  a: ({ node: _, ...p }) => <a className="text-primary underline underline-offset-4" target="_blank" rel="noopener noreferrer" {...p} />,
  ul: ({ node: _, className, ...p }) => <ul className={cn("my-3 list-disc pl-6", className?.includes("contains-task-list") && "list-none pl-1")} {...p} />,
  ol: ({ node: _, ...p }) => <ol className="my-3 list-decimal pl-6" {...p} />,
  li: ({ node: _, ...p }) => <li className="my-1 [&>input]:mr-2 [&>input]:align-middle" {...p} />,
  blockquote: ({ node: _, ...p }) => <blockquote className="my-3 border-l-4 pl-4 text-muted-foreground" {...p} />,
  hr: () => <hr className="my-6" />,
  img: ({ node: _, ...p }) => <img className="max-w-full" {...p} />,
  table: ({ node: _, ...p }) => <div className="my-3 overflow-x-auto"><table className="border-collapse text-sm" {...p} /></div>,
  th: ({ node: _, ...p }) => <th className="border bg-muted px-3 py-1.5 text-left font-medium" {...p} />,
  td: ({ node: _, ...p }) => <td className="border px-3 py-1.5" {...p} />,
  code: ({ node: _, ...p }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...p} />,
  pre: ({ node }) => {
    const code = node?.children[0];
    if (code?.type !== "element")
      return null;
    const text = code.children.map(c => c.type === "text"
      ? c.value
      : "").join("").replace(/\n$/, "");
    const classes = code.properties.className;
    const lang = (Array.isArray(classes)
      ? classes
      : [])
      .map(String)
      .find(c => c.startsWith("language-"))
      ?.slice("language-".length) ?? "";
    return <div className="my-3"><CodeBlock code={text} lang={lang.toLowerCase()} /></div>;
  },
};

function Rendered({ entry, client, labels }: PreviewProps) {
  const query = useFileText(client, entry.mount, entry.path);
  if (query.isPending)
    return <div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>;
  if (query.isError)
    return <div className="p-4 text-sm text-destructive">{query.error.message}</div>;
  return (
    <article className="mx-auto max-w-3xl px-6 py-4 text-sm wrap-break-word">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{query.data.text}</Markdown>
    </article>
  );
}

/** Rendered Markdown by default; Source is the text editor, kept mounted once opened so drafts survive toggling. */
export function MarkdownPreview(props: PreviewProps) {
  const { entry, labels, actions } = props;
  const [source, setSource] = useState(false);
  const [sourceOpened, setSourceOpened] = useState(false);

  if (entry.size > MAX_BYTES)
    return <LazyTextPreview {...props} />;

  const show = (s: boolean) => {
    setSource(s);
    if (s)
      setSourceOpened(true);
  };

  return (
    <div className="relative h-full">
      {actions && createPortal(
        <div className="flex items-center rounded-lg border p-0.5">
          {[false, true].map(s => (
            <Button
              key={String(s)}
              size="xs"
              variant={s === source
                ? "secondary"
                : "ghost"}
              aria-pressed={s === source}
              onClick={() => show(s)}
            >
              {s
                ? labels.markdownSource
                : labels.markdownRendered}
            </Button>
          ))}
        </div>,
        actions,
      )}
      {!source && (
        <div className="h-full overflow-auto">
          <Rendered {...props} />
        </div>
      )}
      {sourceOpened && (
        <div className={cn("h-full", !source && "hidden")}>
          <LazyTextPreview
            {...props}
            // The Save button belongs in the header only while the editor is visible.
            actions={source
              ? (actions ?? null)
              : null}
          />
        </div>
      )}
    </div>
  );
}
