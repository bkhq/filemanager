import type { OpsRequest, SortKey } from "../core/schema";
import type { FmClient } from "./client";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const fmKeys = {
  all: (client: FmClient) => ["fm", client.baseUrl] as const,
  mounts: (client: FmClient) => [
    ...fmKeys.all(client),
    "mounts",
  ] as const,
  lists: (client: FmClient, mount: string) => [
    ...fmKeys.all(client),
    "list",
    mount,
  ] as const,
  list: (client: FmClient, mount: string, path: string, sort: SortKey, order: "asc" | "desc", q = "") =>
    [
      ...fmKeys.lists(client, mount),
      path,
      sort,
      order,
      q,
    ] as const,
  trash: (client: FmClient, mount: string) => [
    ...fmKeys.all(client),
    "trash",
    mount,
  ] as const,
  usage: (client: FmClient, mount: string, path: string) => [
    ...fmKeys.lists(client, mount),
    "usage",
    path,
  ] as const,
  text: (client: FmClient, mount: string, path: string) => [
    ...fmKeys.all(client),
    "text",
    mount,
    path,
  ] as const,
};

export function useMounts(client: FmClient) {
  return useQuery({
    queryKey: fmKeys.mounts(client),
    queryFn: () => client.mounts(),
  });
}

const PAGE = 500;

/** Directory listing, paged by the server cursor; `q` filters names. */
export function useListing(client: FmClient, mount: string | undefined, path: string, sort: SortKey, order: "asc" | "desc", q = "") {
  return useInfiniteQuery({
    queryKey: fmKeys.list(client, mount ?? "", path, sort, order, q),
    enabled: !!mount,
    // Keep rows on screen while a new filter loads.
    placeholderData: keepPreviousData,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.list(mount!, path, {
      cursor: pageParam,
      limit: PAGE,
      sort,
      order,
      q,
    }),
    getNextPageParam: last => last.cursor,
  });
}

export function useTrash(client: FmClient, mount: string | undefined, enabled = true) {
  return useQuery({
    queryKey: fmKeys.trash(client, mount ?? ""),
    queryFn: () => client.trash(mount!),
    enabled: enabled && !!mount,
  });
}

export function useUsage(client: FmClient, mount: string, path: string, enabled = true) {
  return useQuery({
    queryKey: fmKeys.usage(client, mount, path),
    queryFn: () => client.usage(mount, path),
    enabled,
  });
}

export function useFileText(client: FmClient, mount: string, path: string, enabled = true) {
  return useQuery({
    queryKey: fmKeys.text(client, mount, path),
    queryFn: () => client.readText(mount, path),
    enabled,
    staleTime: 0,
  });
}

/** Mutations that refresh every listing (and the trash) of the mount on success. */
export function useFmMutations(client: FmClient, mount: string) {
  const qc = useQueryClient();
  const invalidate = () => Promise.all([
    qc.invalidateQueries({
      queryKey: fmKeys.lists(client, mount),
    }),
    qc.invalidateQueries({
      queryKey: fmKeys.trash(client, mount),
    }),
  ]);
  return {
    mkdir: useMutation({
      mutationFn: (path: string) => client.mkdir(mount, path),
      onSuccess: invalidate,
    }),
    ops: useMutation({
      mutationFn: (req: OpsRequest) => client.ops(mount, req),
      onSuccess: invalidate,
    }),
    restore: useMutation({
      mutationFn: (ids: string[]) => client.restore(mount, ids),
      onSuccess: invalidate,
    }),
    purge: useMutation({
      mutationFn: (ids?: string[]) => client.purge(mount, ids),
      onSuccess: invalidate,
    }),
    save: useMutation({
      mutationFn: (v: { path: string; text: string; etag: string }) => client.write(mount, v.path, v.text, { ifMatch: v.etag }),
      onSuccess: async (entry) => {
        await invalidate();
        qc.removeQueries({
          queryKey: fmKeys.text(client, mount, entry.path),
        });
      },
    }),
    invalidate,
  };
}
