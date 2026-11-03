# 20261103-0948-rename-dev-apps Rename demo apps to fm-api / fm-web

- **status**: completed
- **priority**: P1
- **owner**: claude/20261103-apps
- **createdAt**: 2026-11-03 09:48

## Description

Drop the `demo` naming: `apps/demo-api` -> `apps/fm-api`, `apps/demo-web` -> `apps/fm-web` (packages `@bkhq/fm-api` / `@bkhq/fm-web`), planned `demo-worker` -> `fm-worker`, env `FM_DEMO_*` -> `FM_*`, data dir `.tmp/demo-root` -> `.tmp/fm-root`, page title "File manager".

Plan: [20261103-0948-rename-dev-apps](../plan/20261103-0948-rename-dev-apps.md).

## ActiveForm

Renaming the dev apps

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes


- complete: Verified: check, 19 e2e, registry smoke, dev servers.
