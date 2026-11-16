# HTTP API — implementing the backend in another language

The UI (`fm-react`) and the client (`fm-client`) only speak HTTP. `createFmRouter` is the
reference implementation; a host whose backend is Go, Rust, Python, Java … can serve the same
routes itself and keep the React side unchanged.

This page is the wire contract for that case. The source of truth stays the code:
`registry/fm/server/router.ts` (routes), `registry/fm/core/schema.ts` (JSON shapes),
`registry/fm/core/errors.ts` (error codes) and `registry/fm/client/client.ts` (what the UI
actually sends).

## 1. Pick an integration path

| Path | When | What you write |
| --- | --- | --- |
| **Sidecar** | A Bun or Workers process is acceptable next to your service | Nothing in your language. Run `createFmRouter` as a small service, proxy `/api/fm/*` to it, and authenticate in the proxy or in a Hono middleware in front of the router. Storage is a shipped driver or a custom `FmDriver` that calls your service |
| **Native** | No JS runtime on the server | The routes below, in your language |

The sidecar keeps every upgrade a `shadcn add`; a native backend has to follow route changes
by hand (see [§10](#10-keeping-up-with-changes)). Prefer the sidecar unless a JS runtime is
ruled out.

Either way the frontend install is the same:

```bash
bunx shadcn add @bkhq/fm-react      # pulls fm-client and fm-core
```

```tsx
<FileManager baseUrl="/api/fm" />
```

`fm-server` and the drivers are not needed for a native backend.

## 2. Machine-readable spec

The router describes itself with OpenAPI 3.1. The dev host serves the document:

```bash
PORT=3010 bun run --cwd apps/fm-api dev:bare
curl http://localhost:3010/openapi.json > fm-openapi.json
```

Paths in it are prefixed with `/fm` (the dev host's mount point) and its `servers` entry is
the dev host's. Use it to generate request / response types or server stubs
(`oapi-codegen`, `openapi-generator`, `datamodel-code-generator` …). It covers JSON shapes
and query parameters; headers, streaming bodies and the behaviour rules below are only in
this page.

## 3. Conventions

- **Base URL.** Everything lives under one prefix chosen by the host (`/api/fm` here). The UI
  only needs `baseUrl`.
- **Addressing.** `(mount, path)`: the mount id is a URL segment (`/m/:mount/...`), the entry
  path is the `path` query parameter or a JSON field, never part of the URL path.
- **Paths** are POSIX, mount-relative and start with `/`; `/` is the mount root. Normalize
  before use: drop empty and `.` segments; reject `..`, NUL and backslashes with
  `400 INVALID`. Names are at most 255 characters and never contain `/`.
- **JSON** is UTF-8, `Content-Type: application/json`. Optional fields are omitted, not
  `null`. Timestamps are ISO 8601 strings unless stated otherwise; sizes are bytes.
- **File bodies** are raw bytes in both directions (no multipart form, no base64).
- **Authentication** is the host's. `fm-client` can add headers to its `fetch` / XHR calls
  (`createFmClient({ headers })`), but images, video, PDF, thumbnails, downloads and zip
  archives are loaded through plain URLs (`<img src>`, `<a href>`, `<iframe>`), which carry
  cookies only. A native backend should therefore authenticate by same-origin cookie; with
  bearer tokens alone, previews and downloads will not load.
- **CSRF.** Mutations are `PUT` / `POST` / `DELETE` with a JSON or raw body. With cookie
  authentication, apply your framework's CSRF protection or check `Origin`.

### Errors

Every non-2xx response has this body:

```json
{ "error": { "code": "NOT_FOUND", "message": "Not found: /nope" } }
```

| `code` | Status | Meaning |
| --- | --- | --- |
| `NOT_FOUND` | 404 | No such mount, entry, upload session or trash item; also "no `read` permission" |
| `FORBIDDEN` | 403 | Readable, but the action is not allowed |
| `EXISTS` | 409 | Target already exists |
| `NOT_EMPTY` | 409 | Directory not empty |
| `ETAG_MISMATCH` | 412 | `If-Match` did not match |
| `INVALID` | 400 | Bad path, name, part number or part length |
| `INVALID` | 422 | Request failed schema validation (missing field, wrong type, unknown enum) |
| `NOT_A_DIR` / `IS_A_DIR` | 400 | Wrong entry kind for the operation |
| `TOO_LARGE` | 413 | Over an upload, listing or archive limit |
| `UNSUPPORTED` | 405 | The mount lacks the feature (trash, changes, upload sessions, read-only driver) |
| `RANGE` | 416 | Unsatisfiable `Range` |

The UI branches on the **status**, not the code: `404` (folder gone, missing baseline),
`412` (editor conflict dialog) and `403` on a presigned part URL (refresh the URLs). It shows
`message` to the user for everything else. Unexpected failures should be `500` with the same
body shape.

Fail closed: a caller without `read` on a path gets `404`, never `403`, so the API does not
confirm that the path exists.

## 4. Data model

### Capabilities

```json
{ "read": true, "write": true, "delete": true, "rename": true, "move": true, "copy": true }
```

All six keys are always present. The UI shows an action only when the entry's `caps` allow it,
so this object is how the server switches features per user and per folder. Compute it as
"what the storage can do" ∩ "what this caller may do at this path". Children of a listing
carry the caps of the listed directory.

| Cap | Gates |
| --- | --- |
| `read` | Everything; without it the entry does not exist for the caller |
| `write` | Upload, new file / folder, save, being the destination of move / copy / restore |
| `delete` | Delete, purge from trash, being overwritten by a move / copy |
| `rename`, `move`, `copy` | The source side of those operations |

### Entry

```json
{
  "mount": "files",
  "path": "/docs/a.md",
  "name": "a.md",
  "kind": "file",
  "size": 4,
  "mtime": "2026-11-11T15:32:36.269Z",
  "mime": "text/markdown",
  "etag": "2-4",
  "caps": { "read": true, "write": true, "delete": true, "rename": true, "move": true, "copy": true }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `mount`, `path`, `name` | yes | `name` is the last path segment; the root's name is `""` |
| `kind` | yes | `"file"` or `"dir"` |
| `size` | yes | Integer ≥ 0; `0` for directories |
| `mtime` | yes | ISO 8601 |
| `etag` | yes | Opaque string that changes whenever the content changes (size + mtime, a revision number, a content hash). No quotes inside. Used for `If-Match`, HTTP caching and cache-busting URLs |
| `caps` | yes | Effective caps for the caller |
| `mime` | no | Files only. Decides which previewer opens; omit when unknown |
| `id` | no | Stable id that survives rename and move |
| `ignored` | no | `true` for entries matched by an ignore rule (`.gitignore`); shown dimmed |
| `hasSubfolders` | no | Directories only; `false` lets the tree draw a leaf without listing it. Omit when not cheap |
| `extra` | no | Flat object of string / number / boolean / null values the host UI may show (owner, shared …) |

### Mount

```json
{
  "id": "files", "label": "Files", "driver": "local",
  "caps": { "read": true, "write": true, "delete": true, "rename": true, "move": true, "copy": true },
  "trash": true, "thumbnails": false, "changes": false,
  "implicitFolders": false, "uploadSessions": true
}
```

| Field | Required | Effect in the UI |
| --- | --- | --- |
| `id`, `label` | yes | `id` is used in URLs; keep it URL-safe |
| `driver` | yes | Free-form storage name; groups mounts in the tree (`group="driver"`) |
| `caps` | yes | Caps at the mount root |
| `trash` | yes | `true` → deletes are undoable and the trash view is offered; requires [§7](#7-trash-optional) |
| `thumbnails` | yes | `true` → grid view requests `/thumb`; requires the thumbnail route |
| `changes` | yes | `true` → review plugin and change badges call `/changes` (polled every 10 s while shown) |
| `implicitFolders` | yes | `true` → empty folders cannot be stored (flat object stores); the UI keeps new folders locally until a file lands in them |
| `uploadSessions` | yes | `false` → every upload is one `PUT /write`, whatever its size; `true` requires [§6](#6-upload-sessions-optional) |
| `trashRetentionDays` | no | Shown in the trash view |
| `group` | no | Section title in the drive tree ("Personal", "Shared with me") |
| `absoluteRoot` | no | Real directory behind the mount, for "Copy path"; sent to the browser |
| `quota` | no | `{ "used": bytes, "total"?: bytes }`, shown by the drive view |

The five booleans are the feature switches of a native backend: answer `false` and the
matching routes are never called.

## 5. Core routes

Implement these first; with `trash`, `thumbnails`, `changes` and `uploadSessions` all `false`
they are the complete surface the UI uses.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/mounts` | Mounts the caller can read |
| GET | `/m/:mount/stat?path=` | One entry |
| GET | `/m/:mount/list?path=` | A directory, paged |
| GET | `/m/:mount/read?path=` | File bytes |
| PUT | `/m/:mount/write?path=` | Create or replace a file |
| POST | `/m/:mount/mkdir` | Create a directory |
| POST | `/m/:mount/ops` | Rename, move, copy, delete |
| GET | `/m/:mount/search?path=&q=` | Search below a folder |
| GET | `/m/:mount/usage?path=` | Folder size, for the details panel |
| GET | `/m/:mount/archive?path=…` | Download several entries as one zip |

A read-only integration needs `mounts`, `stat`, `list`, `read`, plus `search`, `usage` and
`archive` unless the UI hides them (`features={{ search: false, details: false }}`, and
`archive` is only requested when a folder or several entries are downloaded). Report every
mutating cap as `false` and the rest of the UI disappears.

### `GET /mounts`

`200 { "mounts": Mount[] }`. Leave out mounts the caller cannot read.

### `GET /m/:mount/stat?path=`

`200 Entry`. `path` defaults to `/`. The UI also uses `404` here as "this name is free".

### `GET /m/:mount/list`

| Query | Default | Notes |
| --- | --- | --- |
| `path` | `/` | Must be a directory, else `400 NOT_A_DIR` |
| `limit` | `200` | 1 – 1000 |
| `cursor` | – | Opaque value from the previous page |
| `sort` | `name` | `name` \| `mtime` \| `size` |
| `order` | `asc` | `asc` \| `desc` |
| `q` | – | Case-insensitive substring filter on the names of direct children |
| `hidden` | `1` | `0` drops names starting with `.` |
| `ignored` | `1` | `0` drops entries with `ignored: true` |

```json
{ "entry": Entry, "items": Entry[], "total": 1234, "cursor": "…", "ignored": 3 }
```

- `entry` is the listed directory itself.
- Order: directories first, then by `sort` (names compared case-insensitively with numeric
  collation, so `a2` sorts before `a10`), ties broken by name.
- `total` counts all matching entries, not the page.
- `cursor` is present only when more pages exist. It is yours to define; the client passes it
  back verbatim together with the same `path`, `sort`, `order`, `q`, `hidden` and `ignored`.
- `ignored` is the number of ignored direct children counted before `ignored=0` drops them;
  omit it when zero.

### `GET /m/:mount/read`

Query: `path`; `download=1` forces an attachment; `v=<etag>` is a cache-buster the client
appends and the server ignores.

Response headers the UI relies on:

| Header | Value |
| --- | --- |
| `ETag` | `"<entry.etag>"` — quoted; the editor reads it and sends it back as `If-Match` |
| `Content-Length` | Body length |
| `Accept-Ranges: bytes`, and `206` + `Content-Range` for `Range: bytes=a-b`, `a-`, `-n` | Needed for video / audio seeking and for the head-of-file preview of large text files. `416 RANGE` when unsatisfiable |
| `Content-Type`, `Content-Disposition` | See the rule below |

Honour `If-None-Match` with `304` when you can; it is optional.

**Inline safety rule (security-critical).** These URLs are opened directly by the browser on
your origin, so a stored HTML or SVG file must never execute there:

- Serve inline with the real type only for raster images, SVG, `video/*`, `audio/*` and
  `application/pdf`.
- Serve other text-like types (`text/*`, JSON, XML, YAML, …, including HTML and JavaScript) as
  `text/plain; charset=utf-8`.
- Serve everything else, and everything when `download=1`, as `application/octet-stream`
  with `Content-Disposition: attachment`.
- Always add `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`.
- `Content-Disposition` carries the name twice: an ASCII fallback and
  `filename*=UTF-8''<percent-encoded>`.

The reference is `inlineType` in `registry/fm/server/mime.ts`.

### `PUT /m/:mount/write`

Raw file bytes in the request body.

| Input | Notes |
| --- | --- |
| `path` (query) | Target file. Create missing parent directories |
| `conflict` (query) | `overwrite` (default) \| `fail` → `409 EXISTS` when the file exists \| `rename` → store under the next free name (`a.txt` → `a (1).txt` → `a (2).txt`; the counter goes before the last extension) |
| `If-Match` (header) | `"<etag>"`. When present and the current etag differs (or the file is gone) answer `412 ETAG_MISMATCH` and change nothing |
| `X-Fm-Message` (header) | Optional change note, see below |

`200 Entry` of the written file — with `conflict=rename` its `path` and `name` are the ones
actually used. Over the size limit → `413 TOO_LARGE`. A directory at `path` → `400 IS_A_DIR`.

The upload queue sends files through this route with `XMLHttpRequest` and only looks at the
status; the editor and the sheet plugin read the returned entry for its new `etag`.

### `POST /m/:mount/mkdir`

Body `{ "path": "/new" }` → `201 Entry`; `409 EXISTS` when something is there.

### `POST /m/:mount/ops`

One of three bodies:

```json
{ "op": "delete", "paths": ["/a", "/b"], "permanent": false }
{ "op": "rename", "path": "/docs/a.md", "name": "b.md" }
{ "op": "move",   "paths": ["/a"], "dest": "/target-dir", "destMount": "other", "conflict": "fail" }
```

- `paths`: 1 – 200 items. `copy` has the shape of `move`.
- `dest` is the destination **directory**; each item keeps its name inside it.
- `destMount` is optional and defaults to `:mount`. Supporting another mount is optional:
  the UI offers cross-mount move / copy only between mounts it can write to, so answer
  per-item `UNSUPPORTED` if you do not implement it.
- `conflict`: `fail` (default) \| `rename` \| `overwrite`, as for `write`. The UI sends
  `rename` for copies and pastes.
- `permanent: true` skips the trash.

The response is always `200` with one result per item, in request order; one failed item does
not fail the request:

```json
{ "results": [
  { "path": "/new",  "ok": true,  "trashId": "mwca2lhf-5a0ece14" },
  { "path": "/gone", "ok": false, "error": { "code": "NOT_FOUND", "message": "Not found: /gone" } }
] }
```

- `path` echoes the request item.
- `entry` is the resulting entry for rename, move and copy.
- `trashId` is set when a delete went to the trash; the UI's undo sends it to
  `/trash/restore`.

Rules the reference enforces and a port should too: the root can never be moved, renamed or
deleted; a directory cannot be moved or copied into itself; moving an entry into the folder it
is already in is a no-op success; copying it there picks a free name. With `overwrite`, also
refuse a target that contains the source (moving `/a/a` into `/` would otherwise delete `/a`
and the source with it).

### `GET /m/:mount/search`

| Query | Default | Notes |
| --- | --- | --- |
| `path` | `/` | Folder to search below |
| `q` | – | 1 – 255 characters, required |
| `limit` | `100` | 1 – 500 |
| `mode` | `substring` | `substring`: the name contains `q`, case-insensitive. `fuzzy`: the path below `path` fuzzy-matches `q`, best match first (quick-open, `Ctrl/Cmd+P`) |
| `hidden`, `ignored` | `1` | As for `list`, applied to every segment of the path |

`200 { "items": Entry[], "truncated": boolean }`; `truncated` means the limit or a walk
budget stopped the search. Each item carries its own caps. The fuzzy scoring of the reference
is `registry/fm/core/fuzzy.ts`; any subsequence ranking works, the UI does not re-rank.

### `GET /m/:mount/usage?path=`

`200 { "bytes": n, "files": n, "dirs": n, "truncated": boolean }`; `truncated` marks lower
bounds when the walk was cut short. For a file: its size and `files: 1`.

### `GET /m/:mount/archive?path=/a&path=/b`

`path` repeats, 1 – 100 times. Streams `application/zip` as an attachment. Entry names start
at the selected entry's own name. Check the limits before the first byte: once streaming has
started the status cannot change (`413 TOO_LARGE` otherwise).

### Change notes (`X-Fm-Message`)

Hosts with a commit-message or audit-note field make the client send
`X-Fm-Message: <percent-encoded UTF-8>` on every mutating request (`write`, `mkdir`, `ops`,
trash restore / purge, upload `complete`). Decode with the equivalent of
`decodeURIComponent`; the reference rejects more than 1000 characters with `400 INVALID`.
Ignoring the header is fine.

## 6. Upload sessions (optional)

Advertise `uploadSessions: true` only when these five routes exist. The client then uploads
files of 16 MiB and more in parts, three at a time, retries each part, and resumes after a
reload by asking which parts arrived.

| Method | Route | Body → response |
| --- | --- | --- |
| POST | `/m/:mount/uploads` | `{ "path", "size", "conflict" }` → `201 Session` |
| GET | `/m/:mount/uploads/:id` | → `200 Session` |
| PUT | `/m/:mount/uploads/:id/parts/:n` | raw bytes → `200 { "n", "size" }` |
| POST | `/m/:mount/uploads/:id/complete` | empty → `200 Entry` |
| DELETE | `/m/:mount/uploads/:id` | → `200 { "ok": true }` |

```json
{
  "id": "fed2c4e9-f3c0-41a6-acbf-c96246c4874d",
  "mode": "chunked",
  "path": "/big.bin",
  "size": 10485760,
  "partSize": 8388608,
  "parts": 2,
  "received": [1],
  "expiresAt": 1794497556294
}
```

- The server chooses `partSize`; `parts = max(1, ceil(size / partSize))`. Parts are numbered
  from 1; every part is exactly `partSize` bytes except the last, which is the remainder.
  Reject any other `Content-Length` with `400 INVALID`.
- `path` is the final target, fixed at create time. `conflict` defaults to `rename` here:
  the session then names the free path it picked, and the UI shows that name.
- `received` lists the part numbers stored so far. It is what makes resume work: the client
  sends only the missing ones. Re-sending a part replaces it.
- `expiresAt` is epoch **milliseconds** (the one timestamp that is not ISO).
- `complete` assembles the parts into `path` and answers like `write`. Missing parts →
  `400 INVALID`, and the session stays so the client can retry. After success the session is
  gone.
- Unknown, expired and completed ids → `404`.
- Check the caller's `write` permission on the session's path on every call, not only on
  create.

`mode: "s3-multipart"` is the direct-to-storage variant: the session additionally carries
`urls`, one presigned `PUT` URL per part (`urls[i]` is part `i + 1`). The client sends part
bodies to those URLs with no extra headers and never calls `/parts/:n`; on a `403` from
storage it re-reads the session for fresh URLs. `complete` then finishes the multipart upload
on the server side — the server, not the client, collects the part ETags (S3 `ListParts`).
The bucket must allow `PUT` from the app's origin by CORS.

## 7. Trash (optional)

Advertise `trash: true` only when a non-permanent delete can be undone.

| Method | Route | Body → response |
| --- | --- | --- |
| GET | `/m/:mount/trash` | → `200 { "items": TrashItem[] }`, newest first |
| POST | `/m/:mount/trash/restore` | `{ "ids": [..] }` (1 – 200) → `200 { "results": [..] }` |
| POST | `/m/:mount/trash/purge` | `{ "ids": [..] }`, or `{}` to empty the trash → `200 { "results": [..] }` |

```json
{ "id": "mwca2lhf-5a0ece14", "path": "/new", "name": "new", "kind": "dir", "size": 0,
  "deletedAt": "2026-11-11T15:32:36.291Z", "expiresAt": "2026-12-11T15:32:36.291Z" }
```

- `path` is the original path. `expiresAt` is optional.
- Results have the shape of `ops` results with the trash id in `path`; a restore carries the
  restored `entry`.
- Restore puts the item back at its original path, or under a free name when that is taken.
- Authorize each item against its **original path**: list only items the caller may read,
  restore needs `write`, purge needs `delete`.
- However the trash is stored, it must be unreachable through `list`, `stat`, `read`,
  `search`, `archive` and `ops`.
- Without trash: `405 UNSUPPORTED` on these routes.

## 8. Other optional routes

| Route | Advertised by | Contract |
| --- | --- | --- |
| `GET /m/:mount/thumb?path=&w=` | `thumbnails: true` | `w` ∈ `128`, `256`, `512`. Image bytes with a long-lived private cache header, or `404` when no thumbnail can be made — the UI then falls back to an icon. Never thumbnail SVG. `v=<etag>` is a cache-buster |
| `GET /m/:mount/changes` | `changes: true` | `200 { "changes": [{ "path", "status", "previousPath"?, "additions"?, "deletions"? }] }` with `status` ∈ `added`, `modified`, `deleted`, `renamed`, `untracked`: files that differ from a baseline (a commit, a previous version). Only paths the caller may read |
| `GET /m/:mount/changes/base?path=` | `changes: true` | Baseline bytes of `path` (its previous path for renames), served like `read`; `404` when the baseline lacks the file |
| `GET /m/:mount/zip/entries?path=` | `fm-plugin-archive` installed | `200 { "entries": [{ "path", "dir", "size", "compressedSize", "mtime", "encrypted" }], "truncated" }`; directory names end with `/` |
| `GET /m/:mount/zip/read?path=&entry=` | `fm-plugin-archive` installed | One entry's bytes with the inline safety rule of `read`; `download=1` as there |

Leave the plugin out of the UI and the two zip routes are never requested.

## 9. Rules that are easy to miss

A port that passes the happy path can still be unsafe. The reference enforces all of these:

1. **Authorize per path, on every request**, including each item of a batch, the destination
   of a move / copy / restore, and every call of an upload session.
2. **Recursive operations authorize every directory they enter.** `archive`, `usage` and
   `search` skip subtrees the caller cannot read; `copy` fails when the source contains one,
   because the copy would expose it.
3. **Jail local paths.** Resolve symlinks (`realpath`) and check the result is still inside
   the mount root; skip links that point outside when listing.
4. **Hide internal storage** (trash, pending upload parts) from every route, and reject
   writes, renames and moves that would land inside it.
5. **Bound the work**: upload size, entries per listing, entries and bytes per archive and
   per search / usage walk, items per batch (200), paths per archive (100).
6. **Conflict handling must not lose data under races**: `fail` and `rename` create
   exclusively (`O_EXCL`, `If-None-Match: *`); `If-Match` is checked as close to the write as
   the storage allows.
7. **Write atomically** (temp file + rename) so a reader never sees half a file and a failed
   upload leaves the old content.
8. **Apply the inline safety rule** of `read` to every route that returns stored bytes
   (`read`, `changes/base`, `zip/read`).

## 10. Keeping up with changes

- The API has no version field. A registry release may add routes or fields; pin the registry
  URL to a tag (`README.md`, *Install*) and upgrade the UI and a native backend together.
- When upgrading, diff `registry/fm/client/client.ts` and `registry/fm/core/schema.ts`
  between the two tags — together they are everything the UI sends and expects — and
  regenerate the OpenAPI document.
- New optional features arrive behind a mount flag that an older backend does not send; a
  missing optional field reads as "off".

## 11. Checking a port

There is no language-neutral conformance suite yet. Two checks cover most of the contract:

1. **UI smoke.** The demo UI calls `/api/fm` on its own origin. Build it, serve the output
   from your server next to the API, and click through browse, preview, edit, upload (small
   and ≥ 16 MiB), rename, move, copy, delete, undo, search and download.

   ```bash
   bun run --cwd apps/fm-web build       # static files in apps/fm-web/dist
   ```

   Serve `dist/` at `/` (with `index.html` as the fallback) and your routes under `/api/fm`.
2. **Reference diff.** Run the same requests against `apps/fm-api` (`dev:bare`, routes under
   `/fm`) and your server and compare status codes and JSON. The transcript below is a
   starting set; it was taken from a router with a 4-byte `uploadPartSize`.

```text
GET  /mounts                                        200 { "mounts": [...] }
GET  /m/files/list?path=/docs&limit=1               200 { "entry", "items", "total" }
GET  /m/files/stat?path=/nope                       404 NOT_FOUND
GET  /m/unknown/stat?path=/                         404 NOT_FOUND
GET  /m/files/stat?path=/a/../b                     400 INVALID
GET  /m/files/read?path=/docs/a.md                  200 ETag: "2-4", text/plain; charset=utf-8
GET  /m/files/read?path=/docs/a.md  Range: bytes=0-1    206 Content-Range: bytes 0-1/4
GET  /m/files/read?path=/docs/a.md  Range: bytes=9-     416 RANGE
PUT  /m/files/write?path=/docs/a.md  If-Match: "nope"   412 ETAG_MISMATCH
PUT  /m/files/write?path=/docs/a.md&conflict=fail       409 EXISTS
PUT  /m/files/write?path=/docs/a.md&conflict=rename     200 entry.path = "/docs/a (1).md"
POST /m/files/mkdir  { "path": "/new" }             201 Entry      (again: 409 EXISTS)
POST /m/files/mkdir  {}                             422 INVALID
POST /m/files/ops    { "op": "delete", "paths": ["/new", "/gone"] }
                                                    200 results: [ok + trashId, NOT_FOUND]
POST /m/files/uploads  { "path": "/big.bin", "size": 10 }   201 Session (partSize 4 → parts 3)
PUT  /m/files/uploads/:id/parts/2  (2 bytes)        400 INVALID   (must be 4 bytes)
POST /m/files/uploads/:id/complete (parts missing)  400 INVALID
GET  /m/files/changes  (mount without changes)      405 UNSUPPORTED
```
