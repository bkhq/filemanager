# 20261110-0700-list-paging-cost Paged listings stop re-listing the whole folder per page

- **status**: completed
- **priority**: P1
- **owner**: BKD campaign l1-9muv8v7b-20261110-0700
- **createdAt**: 2026-11-10 07:00

## Description

P1: `/list` (`server/router.ts:674`) runs a full `driver.list` per page; local stats entries serially (`drivers/local.ts:606`). Add a short-lived listing snapshot keyed by the cursor and invalidated by router mutations; stat with bounded concurrency in local.

## ActiveForm

Paged listings stop re-listing the whole folder per page

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: 20261110-0700-filen-audit-fixes.
