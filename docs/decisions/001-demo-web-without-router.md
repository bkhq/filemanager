# 001 Demo web app without TanStack Router

- **status**: accepted
- **date**: 2026-11-02
- **sunset**: when the demo grows a second screen

## Context

`pma-web` requires file-based TanStack Router routing. `apps/fm-web` is a
single-screen harness that renders `<FileManager />` for development and e2e;
it ships nothing to hosts.

## Decision

`apps/fm-web` has no router. The registry UI (`registry/fm/react`) does not
depend on a router either, so hosts can mount it in any route.

## Consequences

Adding a second demo screen means adding TanStack Router first.
