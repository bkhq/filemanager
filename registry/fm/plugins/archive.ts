import type { FmPlugin } from "../react/plugins";
import { lazy } from "react";

const ArchivePreview = lazy(() => import("./archive-view").then(m => ({ default: m.ArchivePreview })));

export const ARCHIVE_FILE = /\.(?:zip|jar)$/i;

/** Browse zip archives without extracting them: folder tree, inline preview and download per entry. */
export function archivePlugin(): FmPlugin {
  return {
    id: "archive",
    previewers: [
      {
        id: "archive",
        match: e => e.kind === "file" && ARCHIVE_FILE.test(e.name),
        component: ArchivePreview,
        priority: 10,
      },
    ],
  };
}
