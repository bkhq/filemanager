export interface Selection {
  /** Selected entry paths. */
  paths: ReadonlySet<string>;
  /** Anchor for shift-range selection. */
  anchor?: string | undefined;
}

export const EMPTY_SELECTION: Selection = {
  paths: new Set(),
};

export type SelectMode = "single" | "toggle" | "range";

/** Applies a click to the selection; `order` is the visible order of paths. */
export function select(sel: Selection, path: string, mode: SelectMode, order: readonly string[]): Selection {
  if (mode === "toggle") {
    const paths = new Set(sel.paths);
    if (paths.has(path))
      paths.delete(path);
    else
      paths.add(path);
    return { paths, anchor: path };
  }
  if (mode === "range" && sel.anchor !== undefined) {
    const a = order.indexOf(sel.anchor);
    const b = order.indexOf(path);
    if (a >= 0 && b >= 0) {
      const [from, to] = a < b
        ? [a, b]
        : [b, a];
      return {
        paths: new Set(order.slice(from, to + 1)),
        anchor: sel.anchor,
      };
    }
  }
  return {
    paths: new Set([path]),
    anchor: path,
  };
}

/** Moves the cursor by `delta` rows and selects it (keyboard navigation). */
export function step(sel: Selection, order: readonly string[], delta: number, extend: boolean): Selection {
  if (order.length === 0)
    return sel;
  const current = sel.anchor === undefined
    ? -1
    : order.indexOf(sel.anchor);
  const next = Math.min(order.length - 1, Math.max(0, current + delta));
  const path = order[next]!;
  if (!extend) {
    return {
      paths: new Set([path]),
      anchor: path,
    };
  }
  return {
    ...select(sel, path, "range", order),
    anchor: sel.anchor ?? path,
  };
}

/** Drops selected paths that are no longer visible. */
export function prune(sel: Selection, order: readonly string[]): Selection {
  const visible = new Set(order);
  const paths = new Set([...sel.paths].filter(p => visible.has(p)));
  if (paths.size === sel.paths.size)
    return sel;
  return {
    paths,
    anchor: sel.anchor !== undefined && visible.has(sel.anchor)
      ? sel.anchor
      : undefined,
  };
}

export interface Clipboard {
  mode: "copy" | "cut";
  mount: string;
  paths: string[];
}

export function formatSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10
    ? n.toFixed(1)
    : Math.round(n)} ${units[i]}`;
}

export type FileKind = "dir" | "image" | "video" | "audio" | "pdf" | "text" | "archive" | "other";

const TEXT_NAMES = /\.(?:txt|md|markdown|json|jsonc|ya?ml|toml|ini|env|csv|tsv|log|xml|html?|css|scss|less|[cm]?[jt]sx?|vue|svelte|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|sql|graphql|proto|dockerfile|makefile|gitignore|editorconfig|conf|lock)$/i;

export function kindOf(entry: { kind: "file" | "dir"; name: string; mime?: string | undefined }): FileKind {
  if (entry.kind === "dir")
    return "dir";
  const mime = entry.mime ?? "";
  if (mime.startsWith("image/"))
    return "image";
  if (mime.startsWith("video/"))
    return "video";
  if (mime.startsWith("audio/"))
    return "audio";
  if (mime === "application/pdf")
    return "pdf";
  if (/zip|gzip|x-tar/.test(mime))
    return "archive";
  if (mime.startsWith("text/") || TEXT_NAMES.test(entry.name) || /^(?:Dockerfile|Makefile|LICENSE|README)$/i.test(entry.name))
    return "text";
  return "other";
}
