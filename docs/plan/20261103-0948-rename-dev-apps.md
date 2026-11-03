# 20261103-0948-rename-dev-apps Rename demo apps to fm-api / fm-web

- **status**: completed
- **createdAt**: 2026-11-03 09:48
- **approvedAt**: 2026-11-03 09:48
- **relatedTask**: 20261103-0948-rename-dev-apps

## Context

The two workspace apps are named `demo-api` / `demo-web`, with `FM_DEMO_*` env vars, `.tmp/demo-root` and a "File manager demo" title. References: app sources, `eslint.config.ts`, `playwright.config.ts`, `.env.example`, `registry/fm/plugins/parse.test.ts` (imports the sample xlsx), README, architecture, open backlog plan and the workers-r2 task. CI does not reference the app paths.

## Proposal

| From | To |
|---|---|
| `apps/demo-api`, `@bkhq/demo-api` | `apps/fm-api`, `@bkhq/fm-api` |
| `apps/demo-web`, `@bkhq/demo-web` | `apps/fm-web`, `@bkhq/fm-web` |
| `apps/demo-worker` (planned) | `apps/fm-worker` |
| `FM_DEMO_ROOT`, `FM_DEMO_STATIC`, `FM_DEMO_S3_*` | `FM_ROOT`, `FM_STATIC`, `FM_S3_*` |
| `.tmp/demo-root` | `.tmp/fm-root` |
| "File manager demo" | "File manager" |

Directories move with `git mv`; `bun.lock` is regenerated with bun 1.4.4. Completed plans, old changelog entries and decision records stay as written.

## Risks

- Anyone with a local `.env` using `FM_DEMO_*` must rename the keys (none in this checkout).

## Scope

App directories and sources, `package.json` / `bun.lock`, eslint / playwright config, `.env.example`, one registry test import, README, architecture, open plan / task docs. Verify: lint, typecheck, tests, builds, e2e, registry smoke, dev servers.

## Alternatives

- Keep `FM_DEMO_*`: fewer edits, but leaves the `demo` naming in config.

## Annotations

2026-11-03: user asked for `fm-web` instead of `demo-web`.
