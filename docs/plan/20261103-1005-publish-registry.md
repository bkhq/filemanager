# 20261103-1005-publish-registry Publish the shadcn registry

- **status**: draft
- **createdAt**: 2026-11-03 10:05
- **approvedAt**: (pending)
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
