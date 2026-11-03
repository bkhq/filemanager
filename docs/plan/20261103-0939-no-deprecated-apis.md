# 20261103-0939-no-deprecated-apis Remove deprecated API usage and lint against it

- **status**: completed
- **createdAt**: 2026-11-03 09:39
- **approvedAt**: 2026-11-03 09:39
- **relatedTask**: 20261103-0939-no-deprecated-apis

## Context

A TypeScript language-service scan (diagnostics 6385 / 6387) over every tsconfig plus tests and config files found two deprecated APIs:

- `apps/demo-api/src/index.ts`: `serveStatic` from `hono/bun` (`hono/bun` will be removed in v5; install `@hono/bun`).
- `registry/fm/react/dialogs.tsx`: React `FormEvent` (does not exist as a real event; use `SubmitEvent`).

Nothing in lint catches this today.

## Proposal

- Add `@hono/bun` (1.0.1, latest; peer `hono >=4.13.9`) and import `serveStatic` from it.
- Type the name dialog submit handler as `SubmitEvent<HTMLFormElement>`.
- Enable `ts/no-deprecated` with type information (`parserOptions.project` = root, demo-api and demo-web app tsconfigs) for registry, app sources and scripts.

## Risks

- Type-aware linting roughly doubles lint time (~5 s -> ~11 s).
- `SubmitEvent` exists from `@types/react` 19.2.10 (2026-01-27); hosts on older types fail to compile `fm/react/dialogs.tsx`.
- Files outside those tsconfigs (react / plugin tests, e2e, config files) are not covered by the rule.

## Scope

`eslint.config.ts`, `package.json`, `bun.lock`, `apps/demo-api/src/index.ts`, `registry/fm/react/dialogs.tsx`, changelog. Verify: lint, typecheck, tests, builds, e2e (static serving goes through `serveStatic`).

## Alternatives

- One-off scan without a lint rule: no ongoing cost, but regressions go unnoticed.

## Annotations

2026-11-03: user asked to stop using deprecated APIs and check the whole project.
