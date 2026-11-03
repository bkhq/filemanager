import { z } from "zod";

export const ACTIONS = [
  "read",
  "write",
  "delete",
  "rename",
  "move",
  "copy",
] as const;
export type FmAction = typeof ACTIONS[number];

export const capsSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  delete: z.boolean(),
  rename: z.boolean(),
  move: z.boolean(),
  copy: z.boolean(),
});
export type FmCaps = z.infer<typeof capsSchema>;

export const ALL_CAPS: FmCaps = {
  read: true,
  write: true,
  delete: true,
  rename: true,
  move: true,
  copy: true,
};
export const READ_ONLY_CAPS: FmCaps = {
  read: true,
  write: false,
  delete: false,
  rename: false,
  move: false,
  copy: false,
};

export function intersectCaps(a: FmCaps, b: FmCaps): FmCaps {
  return {
    read: a.read && b.read,
    write: a.write && b.write,
    delete: a.delete && b.delete,
    rename: a.rename && b.rename,
    move: a.move && b.move,
    copy: a.copy && b.copy,
  };
}

export const entryKindSchema = z.enum(["file", "dir"]);
export type FmEntryKind = z.infer<typeof entryKindSchema>;

export const entrySchema = z.object({
  mount: z.string(),
  path: z.string(),
  name: z.string(),
  kind: entryKindSchema,
  size: z.number().int().nonnegative(),
  mtime: z.string(),
  mime: z.string().optional(),
  etag: z.string(),
  caps: capsSchema,
});
export type FmEntry = z.infer<typeof entrySchema>;

export const mountInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  driver: z.string(),
  caps: capsSchema,
  /** Deletes go to a restorable trash. */
  trash: z.boolean(),
});
export type FmMountInfo = z.infer<typeof mountInfoSchema>;

export const SORT_KEYS = ["name", "mtime", "size"] as const;
export const sortKeySchema = z.enum(SORT_KEYS);
export type FmSortKey = z.infer<typeof sortKeySchema>;

export const listResultSchema = z.object({
  entry: entrySchema,
  items: z.array(entrySchema),
  cursor: z.string().optional(),
  total: z.number().int().nonnegative(),
});
export type FmListResult = z.infer<typeof listResultSchema>;

export const searchResultSchema = z.object({
  items: z.array(entrySchema),
  /** The walk or hit limit stopped the search; more matches may exist. */
  truncated: z.boolean(),
});
export type FmSearchResult = z.infer<typeof searchResultSchema>;

export const SEARCH_MODES = ["substring", "fuzzy"] as const;
export const searchModeSchema = z.enum(SEARCH_MODES);
export type FmSearchMode = z.infer<typeof searchModeSchema>;

export const CONFLICT_MODES = ["fail", "rename", "overwrite"] as const;
export const conflictSchema = z.enum(CONFLICT_MODES);
export type FmConflict = z.infer<typeof conflictSchema>;

export const opsRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("delete"),
    paths: z.array(z.string()).min(1).max(200),
    /** Skip the trash even when the mount has one. */
    permanent: z.boolean().default(false),
  }),
  z.object({
    op: z.literal("rename"),
    path: z.string(),
    name: z.string().min(1).max(255),
  }),
  z.object({
    op: z.enum(["move", "copy"]),
    paths: z.array(z.string()).min(1).max(200),
    dest: z.string(),
    conflict: conflictSchema.default("fail"),
  }),
]);
export type FmOpsRequest = z.input<typeof opsRequestSchema>;

export const opResultSchema = z.object({
  path: z.string(),
  ok: z.boolean(),
  entry: entrySchema.optional(),
  /** Set when a delete went to the trash. */
  trashId: z.string().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
});
export type FmOpResult = z.infer<typeof opResultSchema>;

export const opsResultSchema = z.object({
  results: z.array(opResultSchema),
});
export type FmOpsResult = z.infer<typeof opsResultSchema>;

export const trashItemSchema = z.object({
  id: z.string(),
  /** Original path. */
  path: z.string(),
  name: z.string(),
  kind: entryKindSchema,
  size: z.number().int().nonnegative(),
  deletedAt: z.string(),
});
export type FmTrashItem = z.infer<typeof trashItemSchema>;

export const trashIdsSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
});

export const usageSchema = z.object({
  bytes: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  dirs: z.number().int().nonnegative(),
  /** The walk stopped at the entry limit; numbers are lower bounds. */
  truncated: z.boolean(),
});
export type FmUsage = z.infer<typeof usageSchema>;

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type FmErrorBody = z.infer<typeof errorBodySchema>;
