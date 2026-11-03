# 20261103-0939-no-deprecated-apis Remove deprecated API usage and lint against it

- **status**: completed
- **priority**: P1
- **owner**: claude/20261103-deprecated
- **createdAt**: 2026-11-03 09:39

## Description

Replace deprecated APIs (`serveStatic` from `hono/bun`, React `FormEvent`) and add `ts/no-deprecated` to lint so new usages fail.

Plan: [20261103-0939-no-deprecated-apis](../plan/20261103-0939-no-deprecated-apis.md).

## ActiveForm

Removing deprecated API usage

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes


- complete: Verified: lint with ts/no-deprecated, typecheck, 82 tests, builds, 19 e2e, registry smoke.
