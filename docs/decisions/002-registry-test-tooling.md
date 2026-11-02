# 002 Registry test tooling

- **status**: accepted
- **date**: 2026-11-02
- **sunset**: revisit when `fm/react` gains logic not covered by e2e

## Context

`pma-web` names Vitest for frontend unit tests. Registry code is plain source
(no package), tested from the repo root with `bun test`.

## Decision

- Pure logic in `registry/fm/react` (`state.ts`) and `registry/fm/client` is
  tested with `bun:test`, like the server code.
- Components are covered by the Playwright suite in `tests/e2e` against the demo.
- No Vitest / Testing Library setup.
- The S3 driver contract runs only when `FM_TEST_S3_ENDPOINT` points at an
  S3-compatible server (verified against RustFS; MinIO images are no longer
  pullable from Docker Hub).
- `scripts/registry-smoke.sh` (`bun run registry:smoke`) needs network access
  and is not part of `bun run check`.

## Consequences

Coverage numbers only reflect `bun test`; UI regressions are caught by e2e.
