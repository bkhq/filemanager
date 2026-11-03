import { z } from "zod";

export const ACTIONS = [
  "read",
  "write",
  "delete",
  "rename",
  "move",
  "copy",
] as const;
export type Action = typeof ACTIONS[number];

export const capsSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  delete: z.boolean(),
  rename: z.boolean(),
  move: z.boolean(),
  copy: z.boolean(),
});
export type Caps = z.infer<typeof capsSchema>;

export const ALL_CAPS: Caps = {
  read: true,
  write: true,
  delete: true,
  rename: true,
  move: true,
  copy: true,
};
export const READ_ONLY_CAPS: Caps = {
  read: true,
  write: false,
  delete: false,
  rename: false,
  move: false,
  copy: false,
};

export function intersectCaps(a: Caps, b: Caps): Caps {
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
export type EntryKind = z.infer<typeof entryKindSchema>;

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
export type Entry = z.infer<typeof entrySchema>;

export const mountInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  driver: z.string(),
  caps: capsSchema,
  /** Deletes go to a restorable trash. */
  trash: z.boolean(),
});
export type MountInfo = z.infer<typeof mountInfoSchema>;

export const SORT_KEYS = ["name", "mtime", "size"] as const;
export const sortKeySchema = z.enum(SORT_KEYS);
export type SortKey = z.infer<typeof sortKeySchema>;

export const listResultSchema = z.object({
  entry: entrySchema,
  items: z.array(entrySchema),
  cursor: z.string().optional(),
  total: z.number().int().nonnegative(),
});
export type ListResult = z.infer<typeof listResultSchema>;

export const CONFLICT_MODES = ["fail", "rename", "overwrite"] as const;
export const conflictSchema = z.enum(CONFLICT_MODES);
export type Conflict = z.infer<typeof conflictSchema>;

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
export type OpsRequest = z.input<typeof opsRequestSchema>;

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
export type OpResult = z.infer<typeof opResultSchema>;

export const opsResultSchema = z.object({
  results: z.array(opResultSchema),
});
export type OpsResult = z.infer<typeof opsResultSchema>;

export const trashItemSchema = z.object({
  id: z.string(),
  /** Original path. */
  path: z.string(),
  name: z.string(),
  kind: entryKindSchema,
  size: z.number().int().nonnegative(),
  deletedAt: z.string(),
});
export type TrashItem = z.infer<typeof trashItemSchema>;

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
export type Usage = z.infer<typeof usageSchema>;

export const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;
