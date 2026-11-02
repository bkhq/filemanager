# Changelog

## 2026-11-02 11:57 [decision]

Project initialised from a survey of bithk (drive/file modules), bkd (files/filesystem routes), zzci/drive (Cloudreve) and open-source file managers; see `docs/architecture.md`. Decisions: shadcn-style registry distribution, generic managed store, demo app only, server code runs on Bun and Cloudflare Workers.

## 2026-11-02 12:10 [decision]

Plan 20261102-1157-p0-foundation approved. Storage backends are "drivers" behind one `Driver` interface (renamed from "provider" in architecture and plan); the `s3` driver moves into P0.

## 2026-11-02 18:30 [progress]

P0 foundation delivered (20261102-1157-p0-foundation): registry items fm-core, fm-server, fm-driver-contract, fm-driver-memory, fm-driver-local, fm-driver-s3, fm-client, fm-react; demo-api + demo-web. Verified: `bun run check` (79 tests incl. S3 contract against RustFS, 95% line coverage), 9 Playwright e2e flows, registry smoke install into a scratch app with non-default aliases.

## 2026-11-02 18:30 [pitfall]

shadcn does not rewrite `@/lib/utils` imports in custom-registry files; `fm/react` imports `cn` from the `cn` package instead. Tailwind in the demo needs `@source` for `registry/fm` because the sources live outside the app.
