# 20261103-0846-naming-conventions Naming conventions for shipped code

- **status**: completed
- **priority**: P1
- **owner**: claude/20261103-naming
- **createdAt**: 2026-11-03 08:46

## Description

Settle names before the registry is published, since every rename afterwards breaks hosts. All exported types under `registry/fm` carry the `Fm` prefix (except `*Props`), the server factory becomes `createFmRouter`, and the rule is documented in `docs/architecture.md` and enforced by lint.

Plan: [20261103-0846-naming-conventions](../plan/20261103-0846-naming-conventions.md).

## ActiveForm

Applying naming conventions

## Dependencies

- **blocked by**: (none)
- **blocks**: 20261103-0508-publish-registry

## Notes


- complete: Verified: lint (incl. naming rule probe), typecheck, 82 unit tests, builds, 19 Playwright e2e (playwright v1.64.1 container), registry smoke.
