# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` imports this file; keep the
instructions here.

## What this is

A generic file manager — Hono router + storage drivers + React UI — shipped as a
[shadcn registry](https://ui.shadcn.com/docs/registry) under the `@bkhq` namespace. Hosts copy
the sources in with `shadcn add` and own them afterwards. There is no npm package and no
standalone product: `apps/*` exist only for development and e2e.

Read `docs/architecture.md` before changing interfaces; it is the design of record (API table,
driver interface, runtime rules, naming).

## Layout

```text
registry/fm/          the product: the files hosts receive (same `@/fm/...` layout as in a host)
  core/               zod schemas, FmError, path and fuzzy helpers — pure TS, no IO
  server/             createFmRouter (router.ts), FmDriver interface, walk, archive / zip, trash, driver contract
  drivers/            memory, local (Bun only), s3 (fetch + SigV4), r2 (Workers binding)
  thumbnails/         thumbnail hooks for Bun (Bun.Image) and Cloudflare Images
  client/             typed fetch client, TanStack Query hooks, upload queue
  react/              <FileManager />, <DriveManager />, FilePicker, previews, dialogs
  plugins/            optional sheet / review / archive / markdown plugins
registry.json         registry manifest: items, their files and dependencies
apps/fm-api           Bun + Hono host of the router (dev and e2e)
apps/fm-web           Vite + React host of the UI; `@/fm/*` aliases into registry/fm
apps/fm-worker        Cloudflare Workers host (wrangler) with an r2 mount
tests/e2e             Playwright suite against fm-api + built fm-web
docs/                 architecture, changelog, decisions (ADRs), plan/, task/
```

Dependency direction: `core ← server ← drivers`, `core ← client ← react ← plugins`.

## Commands

Use the Bun version in `.bun-version` (1.4.4). Shells started by bkd may put an older bundled bun
first on `PATH`; with it a local driver range test fails and `bun install` rewrites `bun.lock`.

```bash
bun install                 # one install; bunfig uses the hoisted linker (registry/ resolves from root node_modules)
bun run check               # lint + typecheck + unit tests with coverage + registry and app builds — the gate
bun run lint                # eslint (antfu config); `bun run lint -- --fix` to autofix
bun run typecheck           # tsc for the registry and every app
bun run test                # bun test registry
bun run test:e2e            # Playwright; builds fm-web and starts fm-api on port 4317
bun run registry:build      # shadcn build -> public/r
bun run registry:smoke      # installs every item into a scratch app (needs network; not in check)
```

Dev servers: `bun run --cwd apps/fm-api dev` and `bun run --cwd apps/fm-web dev` (both behind
`nsl`; `dev:bare` runs without it). Run them in tmux, never in the foreground.

- **S3 contract.** `registry/fm/drivers/s3.test.ts` runs the driver contract only when
  `FM_TEST_S3_ENDPOINT` points at an S3-compatible server (CI uses RustFS with access key
  `fmtest` / secret `fmtest-secret`, bucket `fm-test`). Run it for any change under `drivers/s3.ts`
  or `server/contract.ts`.
- **e2e port.** The port is fixed at 4317, so only one suite may run at a time; serialize
  concurrent runs (e.g. `flock /tmp/fm-e2e-4317.lock bun run test:e2e`). If Chromium's system
  libraries are missing, run the suite in `mcr.microsoft.com/playwright:v1.64.1-noble`.
- **Known flaky e2e.** `image.spec.ts:168` (minimap) and `fm.spec.ts:446` (trash multi-select)
  fail intermittently on `main` too; see `docs/task/`. `fm.spec.ts` runs serially, so one failure
  skips the rest of that file — rerun before blaming a change.

## Rules for shipped code (`registry/fm/**`)

- **Runtimes.** `core`, `server`, `client` and the router use Web-standard APIs only (`Request`,
  `Response`, streams, `crypto.subtle`, `fetch`): no `Bun.*`, no `node:*`. Runtime-specific code
  lives in its own driver or hook file (`drivers/local.ts`, `thumbnails/bun.ts`). `fm-worker`'s
  build proves the Workers side.
- **Naming** (lint-enforced, `docs/architecture.md` §3.0.2): exported types carry the `Fm` prefix
  (`FmEntry`, `FmDriver`; React `*Props` exempt); factories are `createFm*` / `<name>Driver()` /
  `<name>Plugin()`; runtime identifiers use `fm` / `fm-` / `FM_`.
- **Copy semantics.** Hosts diff their copy on every upgrade: keep surfaces small and stable, no
  generated banners, no imports from outside `registry/fm` except declared dependencies. Import
  `cn` from the `cn` package (shadcn does not rewrite `@/lib/utils` in custom registry files).
- **New files** must be added to the matching item in `registry.json`; new dependencies go in the
  item's `dependencies` and the root `package.json`.
- **Drivers** must pass `server/contract.ts`; a new behaviour every driver needs belongs in the
  contract, not in one driver's tests.
- **Router state** must not be keyed by driver instance alone: hosts may build drivers per request
  (`mounts` runs per request). Key by mount id, or document that instances must be reused.
- **Authorization.** `authorize` is called per path; recursive operations call it for every
  directory they descend into (use `server/walk.ts`, never a private BFS). Hidden folders
  (`/.fm-trash`, `/.fm-uploads`) must stay unreachable from every route.
- **Mutations** go through the router's `track()` so change events fire and listing snapshots of
  the mount are dropped.
- **UI** uses shadcn/ui on Base UI (`base-nova`) and Tailwind; everything visible is gated by
  `entry.caps`, not by props. User-facing strings go through `react/labels.ts` (en and zh).

## Tests

- Fixes start with a failing test; features come with tests for the branches they add.
- Unit tests: `bun:test` next to the source (`*.test.ts`), happy-dom where a DOM is needed. Keep
  pure logic in its own module so it can be tested without rendering (ADR 002).
- `.tsx` components are excluded from unit coverage (`bunfig.toml`, 80 % line / function
  threshold); they are covered by `tests/e2e`.
- e2e shares one growing root and virtualized lists render only rows near the viewport: new
  fixtures should sort early (`/0-…`), and filter or scroll before clicking late rows. Clean up
  anything that changes global state (e.g. a git repository) in `finally`.

## Workflow and docs

The project follows the PMA workflow: tasks in `docs/task/` (one file each, indexed in
`docs/task/index.md`; only flip the checkbox marker, append new tasks at the end), plans in
`docs/plan/`, decisions and pitfalls in `docs/changelog.md`, ADRs in `docs/decisions/`. Anything
beyond a trivial change gets a task and an approved plan before implementation.

Write code, comments, docs and commit messages in English; user-facing strings follow
`labels.ts`. Update `README.md` when an option a host sets changes, and `docs/architecture.md`
when an interface or route changes. Record new pitfalls in `docs/changelog.md`.
