import type { FmPlugin } from "../react/plugins";
import { lazy } from "react";

const SheetPreview = lazy(() => import("./sheet-view").then(m => ({ default: m.SheetPreview })));

export const SHEET_FILE = /\.(?:csv|tsv|xlsx)$/i;

/** Table preview for CSV / TSV / XLSX (all sheets). Parsers load only when a sheet is opened. */
export function sheetPlugin(): FmPlugin {
  return {
    id: "sheet",
    previewers: [
      {
        id: "sheet",
        match: e => e.kind === "file" && SHEET_FILE.test(e.name),
        component: SheetPreview,
        // Wins over the built-in text editor for .csv / .tsv.
        priority: 10,
      },
    ],
  };
}
