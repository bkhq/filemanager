# 20261110-0300-flaky-minimap-e2e Flaky e2e: minimap moves the view

- **status**: pending
- **priority**: P3
- **owner**: (unassigned)
- **createdAt**: 2026-11-10 03:00

## Description

`tests/e2e/image.spec.ts` "shows a minimap while zoomed that moves the view" fails intermittently on `main` (3 of 15 runs at 38b9f10, without local changes). Find the race and make the test deterministic.

## ActiveForm

Fixing the flaky minimap e2e

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

(none)
