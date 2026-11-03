import type { Conflict, Entry, ListResult, MountInfo, OpsRequest, OpsResult, SortKey, TrashItem, Usage } from "../core/schema";

export class FmApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "FmApiError";
    this.status = status;
    this.code = code;
  }
}

export interface FmClientOptions {
  /** Where the router is mounted, e.g. `/api/fm`. */
  baseUrl: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Extra headers for every request (auth tokens …). */
  headers?: () => Record<string, string>;
}

export interface ListParams {
  cursor?: string | undefined;
  limit?: number;
  sort?: SortKey;
  order?: "asc" | "desc";
  /** Case-insensitive name filter. */
  q?: string | undefined;
}

export interface WriteParams {
  conflict?: Conflict;
  ifMatch?: string;
}

export type FmClient = ReturnType<typeof createFmClient>;

export function createFmClient(opts: FmClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const doFetch = opts.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));

  const url = (path: string, query: Record<string, string | string[] | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      for (const item of Array.isArray(v)
        ? v
        : (v === undefined
            ? []
            : [v]))
        q.append(k, item);
    }
    const s = q.toString();
    return `${base}${path}${s
      ? `?${s}`
      : ""}`;
  };

  const m = (mount: string) => `/m/${encodeURIComponent(mount)}`;

  const request = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(opts.headers?.() ?? {}))
      headers.set(k, v);
    const res = await doFetch(input, { ...init, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined;
      throw new FmApiError(res.status, body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? res.statusText);
    }
    return res;
  };

  const json = async <T>(input: string, init?: RequestInit): Promise<T> => (await request(input, init)).json() as Promise<T>;
  const post = <T>(input: string, body: unknown) =>
    json<T>(input, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    baseUrl: base,
    headers: () => opts.headers?.() ?? {},
    mounts: () => json<{ mounts: MountInfo[] }>(url("/mounts")).then(r => r.mounts),
    stat: (mount: string, path: string) => json<Entry>(url(`${m(mount)}/stat`, { path })),
    list: (mount: string, path: string, p: ListParams = {}) => json<ListResult>(url(`${m(mount)}/list`, {
      path,
      cursor: p.cursor,
      limit: p.limit?.toString(),
      sort: p.sort,
      order: p.order,
      q: p.q || undefined,
    })),
    /** URL for `<img src>` / `<a href>`; `download` forces an attachment. */
    readUrl: (mount: string, path: string, o: { download?: boolean; version?: string } = {}) =>
      url(`${m(mount)}/read`, {
        path,
        download: o.download ? "1" : undefined,
        v: o.version,
      }),
    archiveUrl: (mount: string, paths: string[]) => url(`${m(mount)}/archive`, { path: paths }),
    writeUrl: (mount: string, path: string, conflict: Conflict = "overwrite") => url(`${m(mount)}/write`, { path, conflict }),
    readText: async (mount: string, path: string) => {
      const res = await request(url(`${m(mount)}/read`, { path }));
      return {
        text: await res.text(),
        etag: (res.headers.get("etag") ?? "").replace(/"/g, ""),
      };
    },
    write: (mount: string, path: string, body: BodyInit, p: WriteParams = {}) => json<Entry>(url(`${m(mount)}/write`, { path, conflict: p.conflict }), {
      method: "PUT",
      body,
      ...(p.ifMatch
        ? {
            headers: { "if-match": `"${p.ifMatch}"` },
          }
        : {}),
    }),
    mkdir: (mount: string, path: string) => post<Entry>(url(`${m(mount)}/mkdir`), { path }),
    ops: (mount: string, req: OpsRequest) => post<OpsResult>(url(`${m(mount)}/ops`), req),
    usage: (mount: string, path: string) => json<Usage>(url(`${m(mount)}/usage`, { path })),
    trash: (mount: string) => json<{ items: TrashItem[] }>(url(`${m(mount)}/trash`)).then(r => r.items),
    restore: (mount: string, ids: string[]) => post<OpsResult>(url(`${m(mount)}/trash/restore`), { ids }),
    /** Without `ids`, empties the trash. */
    purge: (mount: string, ids?: string[]) => post<OpsResult>(url(`${m(mount)}/trash/purge`), ids
      ? { ids }
      : {}),
  };
}
