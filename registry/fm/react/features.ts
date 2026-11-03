import type { Entry } from "../core/schema";

/**
 * UI feature switches. They only hide actions; the server still enforces caps,
 * so use `authorize` / `readOnly` mounts for real access control.
 */
export interface Features {
  upload: boolean;
  createFolder: boolean;
  createFile: boolean;
  /** Edit text files in the preview. */
  edit: boolean;
  rename: boolean;
  move: boolean;
  copy: boolean;
  delete: boolean;
  download: boolean;
  search: boolean;
  details: boolean;
  /** Show the trash view of mounts that have one. */
  trash: boolean;
}

export const ALL_FEATURES: Features = {
  upload: true,
  createFolder: true,
  createFile: true,
  edit: true,
  rename: true,
  move: true,
  copy: true,
  delete: true,
  download: true,
  search: true,
  details: true,
  trash: true,
};

/** Browse, preview, search and download only. */
export const VIEW_ONLY_FEATURES: Features = {
  ...ALL_FEATURES,
  upload: false,
  createFolder: false,
  createFile: false,
  edit: false,
  rename: false,
  move: false,
  copy: false,
  delete: false,
  trash: false,
};

export function resolveFeatures(readOnly = false, overrides: Partial<Features> = {}): Features {
  return {
    ...(readOnly
      ? VIEW_ONLY_FEATURES
      : ALL_FEATURES),
    ...overrides,
  };
}

/** Narrows an entry's caps to the enabled features, so every caps check in the UI honours them. */
export function maskEntry(entry: Entry, f: Features): Entry {
  return {
    ...entry,
    caps: {
      ...entry.caps,
      write: entry.caps.write && (f.upload || f.createFolder || f.createFile || f.edit || f.move || f.copy),
      rename: entry.caps.rename && f.rename,
      move: entry.caps.move && f.move,
      copy: entry.caps.copy && f.copy,
      delete: entry.caps.delete && f.delete,
    },
  };
}
