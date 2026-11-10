# 20261110-0700-walk-thumb-budget Walk metadata reuse, thumbnail concurrency limit, bounded session sweep

- **status**: completed
- **priority**: P2
- **owner**: BKD campaign l1-9muv8v7b-20261110-0700
- **createdAt**: 2026-11-10 07:00

## Description

P2 / S4 / P3 / R3: `collect` re-stats every child (`server/archive.ts:24`); thumbnails decode without a bound (`server/router.ts:913`); `sweepUploads` reads every session record (`server/router.ts:1481`).

## ActiveForm

Walk metadata reuse, thumbnail concurrency limit, bounded session sweep

## Dependencies

- **blocked by**: 20261110-0700-walk-authorize
- **blocks**: (none)

## Notes

Plan: 20261110-0700-filen-audit-fixes.
