import type { ComponentType } from "react";
import type { Entry } from "../core/schema";
import type { PreviewProps } from "./previewers";
import { FallbackPreview, ImagePreview, LazyTextPreview, MediaPreview, PdfPreview } from "./previewers";
import { kindOf } from "./state";

export interface Previewer {
  id: string;
  match: (entry: Entry) => boolean;
  component: ComponentType<PreviewProps>;
  /** Higher wins; built-ins use 0. */
  priority?: number;
}

const previewers: Previewer[] = [
  {
    id: "image",
    match: e => kindOf(e) === "image",
    component: ImagePreview,
  },
  {
    id: "media",
    match: e => ["video", "audio"].includes(kindOf(e)),
    component: MediaPreview,
  },
  {
    id: "pdf",
    match: e => kindOf(e) === "pdf",
    component: PdfPreview,
  },
  {
    id: "text",
    match: e => kindOf(e) === "text",
    component: LazyTextPreview,
  },
];

/** Adds or replaces (by id) a previewer, e.g. a spreadsheet viewer. */
export function registerPreviewer(p: Previewer): void {
  const i = previewers.findIndex(x => x.id === p.id);
  if (i >= 0)
    previewers.splice(i, 1);
  previewers.push(p);
}

/** Best previewer for `entry`; `extra` (from plugins) competes with the registered ones. */
export function findPreviewer(entry: Entry, extra: readonly Previewer[] = []): ComponentType<PreviewProps> {
  const match = [
    ...previewers,
    ...extra,
  ]
    .filter(p => p.match(entry))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  return match?.component ?? FallbackPreview;
}
