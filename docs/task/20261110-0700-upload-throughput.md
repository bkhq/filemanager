# 20261110-0700-upload-throughput Uploads: parallel parts, coalesced progress, leave-page guard, pause / resume

- **status**: completed
- **priority**: P2
- **owner**: BKD campaign l1-9muv8v7b-20261110-0700
- **createdAt**: 2026-11-10 07:00

## Description

P4: parts of one file go serially (`client/upload.ts:215`) and every progress event rewrites the task list (`client/upload.ts:228`). Add parallel parts, per-frame progress, a beforeunload guard while uploads run, pause / resume.

## ActiveForm

Uploads: parallel parts, coalesced progress, leave-page guard, pause / resume

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: 20261110-0700-filen-audit-fixes.
