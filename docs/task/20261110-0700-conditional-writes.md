# 20261110-0700-conditional-writes Atomic conditional writes and race-free rename conflicts

- **status**: completed
- **priority**: P1
- **owner**: BKD campaign l1-9muv8v7b-20261110-0700
- **createdAt**: 2026-11-10 07:00

## Description

S2: s3 `checkTarget` (`drivers/s3.ts:283`) and local `prepareWrite` (`drivers/local.ts:445`) check then write; `/write` with `conflict: rename` writes non-exclusively (`server/router.ts:528`). Use conditional PUT on s3 / `onlyIf` on r2, write exclusively and retry the next free name, document the local overwrite race.

## ActiveForm

Atomic conditional writes and race-free rename conflicts

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: 20261110-0700-filen-audit-fixes.
