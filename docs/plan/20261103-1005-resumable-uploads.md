# 20261103-1005-resumable-uploads Large and resumable uploads

- **status**: implementing
- **createdAt**: 2026-11-03 10:05
- **approvedAt**: 2026-11-03 11:26
- **relatedTask**: 20261103-0508-resumable-uploads

## Context

Uploads are a single `PUT /m/:mount/write` (`registry/fm/server/router.ts:399-436`) capped by `FmLimits.maxUploadBytes` (100 MiB, line 52). The S3 driver buffers the whole body (`registry/fm/drivers/s3.ts:305-315`, `readAll`). The client queue (`registry/fm/client/upload.ts:71-173`) uses a pluggable `FmTransport` (XHR, line 40). Upload sessions are sketched in `docs/architecture.md` §4. Wave 2.

## Proposal

- Session API: `POST /m/:mount/uploads {path, size, conflict}` -> `{ id, mode: "put" | "chunked" | "s3-multipart", partSize, urls? }`; `PUT .../uploads/:id/parts/:n`; `GET .../uploads/:id` (received parts); `POST .../uploads/:id/complete`; `DELETE .../uploads/:id`.
- Optional driver capability `FmDriver.multipart?` (`begin`, `uploadPart` or `presignPart`, `complete`, `abort`, `listParts`): S3 implements it with multipart upload and presigned part URLs (browser uploads straight to the bucket); local stores parts in a temp dir and concatenates on complete; memory buffers. Drivers without it get the router's generic chunked fallback.
- S3 single PUT stops buffering when the size is known (stream with `Content-Length`).
- Client queue: sessions above a threshold (default 16 MiB), per-part retry with backoff, resume after reload via `localStorage` (session id + file fingerprint).
- Session expiry and cleanup of abandoned parts (lazy on next session create).

## Acceptance

- Driver contract additions for multipart (memory, local, S3 against RustFS).
- Router tests: resume after abort, complete with missing part fails, conflict on complete.
- e2e: upload a multi-part file (small `partSize` in the test config).
- `bun run check` and `bun run test:e2e` pass.

## Risks

- Public API growth on `FmDriver` and new routes; S3 CORS must allow browser PUT to presigned URLs (documented for hosts).

## Scope

`server/driver.ts`, `server/router.ts` (+ test), `server/contract.ts`, `drivers/{memory,local,s3}.ts` (+ tests), `core/schema.ts`, `client/upload.ts` (+ test), `client/client.ts`, `tests/e2e/fm.spec.ts`, `docs/architecture.md`.

## Alternatives

- tus protocol server: standard clients, but a larger server surface and a new dependency.
