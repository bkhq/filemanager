# 20261105-1400-review-changes Changes / review, external edits, SVG preview

- **status**: completed
- **createdAt**: 2026-11-05 14:00
- **approvedAt**: 2026-11-05 14:00
- **relatedTask**: 20261103-0508-bkd-pilot (prerequisites for adopting fm in bkd and bks)

## Context

- bkd's issue workspace has a Review tab (`ChangesTree.tsx`, `DiffPanel.tsx` ~840 lines, `/issues/{id}/changes[/file]`): git status of the issue worktree against a base commit, per-file and all-files diffs. The same "baseline + changes" shape appears in bks skills (previous commit) and the planned managed store (previous version).
- bkd notices files changed on disk while open (agents edit concurrently); fm only finds out on save (412).
- fm never serves SVG inline (XSS); bkd renders SVG with a source toggle.

## Proposal

1. **Changes capability** (core, Web-API):
   - `FmDriver.changes?: { list(): Promise<FmChange[]>; readBase(path): Promise<FmReadResult | null> }`, `FmChange = { path, status: "added" | "modified" | "deleted" | "renamed" | "untracked", previousPath?, additions?, deletions? }`.
   - Routes `GET /m/:mount/changes` and `GET /m/:mount/changes/base?path` (authorized like `read`; base of an added file → 404); `FmMountInfo.changes: boolean`.
   - `localDriver({ git: { base?: string | (() => string | Promise<string>) } })`: `git status --porcelain=v2 -z` + `git diff --numstat <base>` (default `HEAD`), `git show <base>:<path>` for the base bytes; outside a work tree → no changes capability.
2. **Status decorations** (core UI): list / grid / tree rows show the status letter and colour (A green, M amber, D red, R blue, U grey), folders containing changes get a dot; a "Changes" tree section (like Starred) lists changed files as a tree; refreshed with the listing and on focus.
3. **`fm-plugin-review`** (lazy, `@codemirror/merge`): plugin extension point `diff` — opening an entry from the Changes section (or "Open changes" in its context menu) shows a side-by-side / unified diff of base vs current (editable current side when writable, same save path as the editor); a "Review all changes" view stacks every changed file's diff (virtualized, each loads on demand), with collapse all / expand all and the unified / split toggle remembered.
4. **External changes**: while a text file is open, its etag is re-checked every 5 s and on window focus; unchanged editor → reloads silently, dirty editor → banner "Changed on disk" with Reload / Keep mine (Save then overwrites).
5. **SVG preview**: `/read` may serve `image/svg+xml` inline because every response already carries `Content-Security-Policy: sandbox` (scripts never run, even when opened directly); SVG opens in the image preview with a Source toggle to the editor.

Change messages are covered by 20261105-1300-change-message.

## Risks

- git on large repos: status is one porcelain call per refresh; numstat skipped above 2 000 changed files.
- `@codemirror/merge` on big files: diff only text ≤ 2 MiB, otherwise "too large to diff" + download.

## Scope

`server/driver.ts`, `server/router.ts` (+ tests), `drivers/local.ts` (+ tests with a temp git repo), `core/schema.ts`, `client/*`, `react/file-list.tsx`, `react/file-tree.tsx`, `react/file-manager.tsx`, `react/text-preview.tsx`, `react/previewers.tsx`, `react/plugins.ts`, new `plugins/review*.tsx`, `server/mime.ts`, labels, `registry.json`, demo (`fm-api` local mount is a git repo in dev), README, e2e.

## Verification

Unit / router tests (git changes against a temp repo incl. renames, untracked, deleted, base override; base read; authorize), `bun run check`, `registry:smoke`, e2e (decorations after an API write, Changes section, diff view split / unified, review all, external change reload and banner, SVG preview + source).

## Annotations

2026-11-05: user approved the direction ("可以，go"): changes data + decorations in core, diff UI as a lazy plugin on @codemirror/merge.

## As built

- Core: `FmDriver.changes` (`list`, `readBase`), `FmChange`; routes `/changes` (filtered by `authorize` and hidden folders) and `/changes/base` (sandboxed like `/read`, 404 without a base); `FmMountInfo.changes`. `localDriver({ gitChanges: true | { base } })`: `git diff --name-status -M --relative <base>` + `ls-files --others --exclude-standard` + `--numstat` (skipped above 2 000 files), `git show <base>:./path` (falls back to the previous path of a rename); empty outside a work tree.
- Client / hooks: `client.changes`, `client.baseText`, `changesQuery` (under the mount's list keys, 10 s poll + focus).
- UI: `react/changes.ts` (`CHANGE_STYLE`, `indexChanges`), `ChangeBadge`; list / grid / tree names coloured with a status letter, folders holding changes get a dot; a "Changes" tree section (drive → folders → files) whose files open the diff; "Open changes" in entry menus; "Review all changes" in the explorer More menu. Plugin extension point `FmPlugin.review` (`FmReviewProps`); the view fills the explorer pane, or `ReviewDialog` in the single layout.
- `fm-plugin-review`: `@codemirror/merge` (`MergeView` side by side, `unifiedMergeView` inline, unchanged runs collapsed, read-only), theme / language shared with the editor via `react/code-language.ts`; review-all stacks collapsible sections that mount their diff when scrolled near; style remembered (`fm:diff-style`). Deviation: the diff is read-only (the plan allowed editing the current side) — the "Open file" button opens it in the editor.
- External changes: `TextPreview` polls `stat` every 5 s and on focus; clean editor → reload, dirty → existing conflict banner; "Keep editing" adopts the new version so Save overwrites.
- SVG: served as `image/svg+xml` inline (every inline response carries the sandbox CSP); `SvgPreview` shows the image with a source toggle.
- Demo: local mount `gitChanges: true` (run `git init` in the root to see it), `reviewPlugin()`.
- Verified: `bun run check` (279 tests: git changes against temp repos incl. renames / untracked / deletes / custom base / sub-root, router changes routes, SVG headers), `registry:smoke`, e2e 82/82 (decorations, Changes section, split / inline diff, review all, external reload + banner, SVG). Two older e2e tests now filter the root before opening (the virtualized list / tree no longer renders rows far down the grown e2e root).
- 2026-11-05: diff rendering switched from `@codemirror/merge` to `@pierre/diffs` (`MultiFileDiff` with full old / new texts, `Virtualizer` for review-all, shiki themes github-light/dark-default) at the user's request, matching bkd's Review tab; no worker pool (keeps the plugin bundler-agnostic).
