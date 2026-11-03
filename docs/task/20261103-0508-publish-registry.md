# 20261103-0508-publish-registry Publish the shadcn registry

- **status**: in_progress
- **priority**: P1
- **owner**: bkd-l2/vid1r7hm
- **createdAt**: 2026-11-03 05:08

## Description

Deploy `public/r` (GitHub Pages, tagged versions) so hosts can `shadcn add @bkhq/...`; smoke-test the deployed URL.

Design sketch and verification: [backlog proposals](../plan/20261103-0508-backlog-proposals.md). Write and get approval for a dedicated plan before implementing.

## ActiveForm

Publishing the registry

## Dependencies

- **blocked by**: 20261103-0846-naming-conventions
- **blocks**: 20261103-0508-bkd-pilot

## Notes

- 2026-11-03: requirement plan [20261103-1005-publish-registry](../plan/20261103-1005-publish-registry.md) (campaign [20261103-1005-p1-campaign](../plan/20261103-1005-p1-campaign.md)).
- 2026-11-03: implemented on bkd/vid1r7hm: `.github/workflows/registry.yml` publishes `/next/r/`, `/v{version}/r/` and `/r/` to GitHub Pages, and `registry:smoke` accepts `REGISTRY_URL`; GitHub Pages and the `github-pages` tag rule `v*` must be enabled manually.
