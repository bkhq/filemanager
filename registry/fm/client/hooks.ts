import type { OpsRequest, SortKey } from "../core/schema";
import type { FmClient } from "./client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  list: (client: FmClient, mount: string, path: string, sort: SortKey, order: "asc" | "desc") =>
    [
      ...fmKeys.lists(client, mount),
      path,
      sort,
      order,
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

/** Directory listing, paged by the server cursor. */
export function useListing(client: FmClient, mount: string | undefined, path: string, sort: SortKey, order: "asc" | "desc") {
  return useInfiniteQuery({
    queryKey: fmKeys.list(client, mount ?? "", path, sort, order),
    enabled: !!mount,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.list(mount!, path, {
      cursor: pageParam,
      limit: PAGE,
      sort,
      order,
    }),
    getNextPageParam: last => last.cursor,
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

/** Mutations that refresh every listing of the mount on success. */
export function useFmMutations(client: FmClient, mount: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({
    queryKey: fmKeys.lists(client, mount),
  });
  return {
    mkdir: useMutation({
      mutationFn: (path: string) => client.mkdir(mount, path),
      onSuccess: invalidate,
    }),
    ops: useMutation({
      mutationFn: (req: OpsRequest) => client.ops(mount, req),
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
