import type { ReactNode } from "react";
import type { FmClient } from "../client/client";
import type { FmEntry } from "../core/schema";
import type { FmPreviewer } from "./preview-registry";

/** What an action can do besides reading its targets. */
export interface FmActionContext {
  client: FmClient;
  /** Mount of the current folder. */
  mount: string;
  /** Current folder path. */
  path: string;
  /** Refetch listings after the action changed files. */
  refresh: () => Promise<void>;
  /** Open an entry in the preview dialog. */
  preview: (entry: FmEntry) => void;
  /** Show an error banner. */
  fail: (message: string) => void;
}

export interface FmFileAction {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown only when this returns true for the targeted entries. */
  when?: (entries: FmEntry[]) => boolean;
  run: (entries: FmEntry[], ctx: FmActionContext) => void | Promise<void>;
}

/**
 * Optional extension: previewers for more file types and context-menu
 * actions. Install one from the registry (e.g. `@bkhq/fm-plugin-sheet`) and
 * pass it with `<FileManager plugins={[sheetPlugin()]} />`.
 */
export interface FmPlugin {
  id: string;
  previewers?: FmPreviewer[];
  actions?: FmFileAction[];
}
