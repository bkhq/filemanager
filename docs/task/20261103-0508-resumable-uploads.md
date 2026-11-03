# 20261103-0508-resumable-uploads Large and resumable uploads

- **status**: in_progress
- **priority**: P1
- **owner**: bkd-l2/wmhautbl
- **createdAt**: 2026-11-03 05:08

## Description

Upload sessions (chunked / S3 multipart with presigned parts), resume after reload, streaming S3 writes.

Design sketch and verification: [backlog proposals](../plan/20261103-0508-backlog-proposals.md). Write and get approval for a dedicated plan before implementing.

## ActiveForm

Adding resumable uploads

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- 2026-11-03: requirement plan [20261103-1005-resumable-uploads](../plan/20261103-1005-resumable-uploads.md) (campaign [20261103-1005-p1-campaign](../plan/20261103-1005-p1-campaign.md)).
- 2026-11-03: implemented on bkd/wmhautbl: upload session routes (create / status / part / complete / abort, hidden `/.fm-uploads`, router-stored parts for drivers without multipart), `FmDriver.multipart` (memory, local, S3 with opt-in presigned parts), streaming S3 PUT when the size is known, client session queue with per-part retry and resume via `localStorage`; e2e multi-part upload. sha256 dedupe not implemented.
