import type { FmZipEntry } from "../core/schema";

export interface FmArchiveNode {
  name: string;
  /** Path inside the archive; folders end with `/`. */
  path: string;
  dir: boolean;
  /** File size, or the sum of the files below a folder. */
  size: number;
  entry?: FmZipEntry;
  children: FmArchiveNode[];
}

/** Folder tree of zip entries; folders that only appear in file paths are added. */
export function buildArchiveTree(entries: readonly FmZipEntry[]): FmArchiveNode {
  const root: FmArchiveNode = {
    name: "",
    path: "",
    dir: true,
    size: 0,
    children: [],
  };
  const folders = new Map<string, FmArchiveNode>([
    ["", root],
  ]);
  const folder = (path: string): FmArchiveNode => {
    const found = folders.get(path);
    if (found)
      return found;
    const parts = path.slice(0, -1).split("/");
    const node: FmArchiveNode = {
      name: parts.at(-1)!,
      path,
      dir: true,
      size: 0,
      children: [],
    };
    folders.set(path, node);
    folder(parts.length > 1
      ? `${parts.slice(0, -1).join("/")}/`
      : "").children.push(node);
    return node;
  };
  for (const entry of entries) {
    const clean = entry.path.replace(/^\/+/, "");
    if (entry.dir) {
      folder(clean).entry = entry;
      continue;
    }
    const cut = clean.lastIndexOf("/");
    const parent = folder(cut < 0
      ? ""
      : clean.slice(0, cut + 1));
    parent.children.push({
      name: clean.slice(cut + 1),
      path: clean,
      dir: false,
      size: entry.size,
      entry,
      children: [],
    });
  }
  const finish = (n: FmArchiveNode): number => {
    n.children.sort((a, b) => (a.dir === b.dir
      ? a.name.localeCompare(b.name)
      : (a.dir
          ? -1
          : 1)));
    if (n.dir)
      n.size = n.children.reduce((sum, c) => sum + finish(c), 0);
    return n.size;
  };
  finish(root);
  return root;
}

export interface FmArchiveRow {
  node: FmArchiveNode;
  depth: number;
}

/** Visible rows: children of open folders, or with a filter the matching files and their folders. */
export function archiveRows(root: FmArchiveNode, open: ReadonlySet<string>, filter = ""): FmArchiveRow[] {
  const q = filter.trim().toLowerCase();
  const matches = (n: FmArchiveNode): boolean => n.dir
    ? n.children.some(matches)
    : n.name.toLowerCase().includes(q);
  const rows: FmArchiveRow[] = [];
  const walk = (n: FmArchiveNode, depth: number) => {
    for (const c of n.children) {
      if (q && !matches(c))
        continue;
      rows.push({ node: c, depth });
      if (c.dir && (q || open.has(c.path)))
        walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}
