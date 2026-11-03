# 20261103-1005-publish-registry Publish the shadcn registry

- **status**: completed
- **createdAt**: 2026-11-03 10:05
- **approvedAt**: 2026-11-03 10:12
- **relatedTask**: 20261103-0508-publish-registry

## Context

`bun run registry:build` writes `public/r` (`package.json` scripts). `github.com/bkhq/filemanager` is public; CI is `.github/workflows/ci.yml` (check, e2e, registry-smoke). `scripts/registry-smoke.sh` builds the registry, serves it locally on `$PORT` and runs `shadcn add @bkhq/...` into a scratch app. README's install snippet still uses `https://<registry-host>/r/{name}.json`.

## Proposal

- New workflow `.github/workflows/registry.yml`:
  - on push to `main`: build and deploy to GitHub Pages under `/next/r/`;
  - on tag `v*`: build and deploy under `/r/` (latest) and `/v{version}/r/` (pinned).
  - Uses `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages` (latest majors verified at implementation time); permissions `pages: write`, `id-token: write`.
  - Keeps earlier versions: the job assembles the site from the `gh-pages`-style artifact of the previous deploy or rebuilds tagged versions; pick the simplest approach that keeps `/v{version}/` stable and record it.
- `scripts/registry-smoke.sh` accepts `REGISTRY_URL` to skip the local server; the workflow runs it against the deployed URL after deploy.
- README: real URL `https://bkhq.github.io/filemanager/r/{name}.json`, pinned form `/v{version}/r/`, and how upgrades work (re-run `shadcn add`, review the diff).

## Acceptance

- Workflow passes `actionlint` (or equivalent YAML validation) locally.
- `REGISTRY_URL=http://localhost:<port>/r bun run registry:smoke` works against a locally served build.
- `bun run check` passes.
- Nothing is pushed or tagged by the campaign; deployment happens when the user pushes.

## Risks

- Outward-facing once pushed (public registry). GitHub Pages must be enabled for the repo (Settings -> Pages -> GitHub Actions); this is a manual step for the user.

## Scope

`.github/workflows/registry.yml` (new), `scripts/registry-smoke.sh`, `README.md`.

## Alternatives

- Serve from a CDN bucket: needs credentials and another service.

## As built

- `.github/workflows/registry.yml` runs on push to `main`, on `v*` tags and on `workflow_dispatch`. Jobs: `build` (assemble site), `deploy` (`github-pages` environment), `smoke` (deployed URL).
- Layout: `main` -> `/next/r/`; each `v*` tag -> `/{tag}/r/` (e.g. `/v0.1.0/r/`); `/r/` is a copy of the highest tag (`git tag --sort=-v:refname`), omitted while no tag exists.
- Earlier versions are kept by rebuilding: every run checks out with `fetch-depth: 0` and builds `main` plus every `v*` tag from git into one site (a `git worktree` per ref, `bun install --frozen-lockfile && bun run registry:build`). No previous artifact is reused.
- Smoke: `scripts/registry-smoke.sh` takes `REGISTRY_URL` (base ending in `/r`, trailing slash trimmed) and skips the local server when set. It copies the value into an internal variable and unsets `REGISTRY_URL`, because the shadcn CLI reads `REGISTRY_URL` as its own default-registry override. The `smoke` job runs it against `<page_url>next/r` and, when a tag exists, `<page_url>r`.
- Action majors (verified): `actions/checkout@v7`, `oven-sh/setup-bun@v2`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`.
- README documents `https://bkhq.github.io/filemanager/r/{name}.json`, the pinned `/v{version}/r/` form, `/next/r/`, and upgrades.
- `actionlint` is clean on `registry.yml`; `ci.yml` has a pre-existing SC2034 warning (out of scope).
- Manual steps for the user (nothing was pushed or tagged):
  1. Settings -> Pages -> Source: GitHub Actions.
  2. Settings -> Environments -> `github-pages` -> Deployment branches and tags -> add tag rule `v*` (otherwise tag deploys are blocked by the environment's default-branch policy).
