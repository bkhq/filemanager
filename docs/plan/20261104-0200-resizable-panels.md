# 20261104-0200-resizable-panels Resizable panels

- **status**: completed
- **createdAt**: 2026-11-04 02:00
- **approvedAt**: 2026-11-04 02:01
- **relatedTask**: 20261104-0200-resizable-panels

## Context

- `registry/fm/react/file-manager.tsx:690-714`: in the split layout the folder tree is `<aside className="w-56 shrink-0 overflow-auto border-r">`; the main `<section>` follows; `DetailsPanel` (`react/details-panel.tsx:47-48`) is `<aside className="w-72 shrink-0 border-l ...">`, or an absolute overlay when the container is narrower than 640px (`overlay={narrow}`).
- Layout state: `split` (tree shown, not narrow) and `detailsOpen`; preferences persist under `storageKey` (`useStoredChoice`).
- shadcn `resizable` for the `base-nova` style wraps `react-resizable-panels` (latest 4.17.0, v4 API: `Group` / `Panel` / `Separator`). v4 accepts pixel sizes (`"224px"`), keyboard-resizes a focused separator, and ships `useDefaultLayout({ id, panelIds, storage })` for persistence.
- `fm-react` lists shadcn components in `registryDependencies` (`registry.json`); hosts get them with `shadcn add`. `apps/fm-web` has no `resizable` yet.

## Proposal

- `apps/fm-web`: `bunx shadcn add resizable` (adds `src/components/ui/resizable.tsx` and `react-resizable-panels` 4.17.0, exact).
- `registry.json`: add `resizable` to `fm-react` `registryDependencies`.
- `file-manager.tsx`: when not narrow, render a horizontal `ResizablePanelGroup`:
  - tree panel (only when `split`): default `224px`, min `160px`, max `40%`;
  - main panel: fills the rest, min `320px`;
  - details panel (only when open): default `288px`, min `220px`, max `50%`;
  - a `ResizableHandle` between neighbours; separators are focusable and resize with the arrow keys.
- Sizes persist in `localStorage` via `useDefaultLayout` with id `${storageKey}:panels` (one saved layout per panel combination, by `panelIds`).
- Narrow containers (< 640px) keep today's behaviour: no tree, details as overlay, no handles.
- `details-panel.tsx`: drop the fixed `w-72` outside overlay mode (the panel sets the width); overlay unchanged.
- Labels: `aria-label` for the handles (en / zh).
- Docs: README UI section, changelog.

## Acceptance

- Dragging the tree / details divider changes the widths; the sizes survive a reload; arrow keys on a focused divider resize.
- Hiding / showing the tree and opening / closing details still work; narrow layout unchanged.
- e2e: drag the tree divider, assert the tree width changed and is kept after reload.
- `bun run check`, e2e suite and `registry:smoke` (host install pulls `resizable`) pass.

## Risks

- New dependency for hosts (`react-resizable-panels`, pulled in by the shadcn `resizable` component).
- Existing e2e selectors that rely on `aside` widths may need updating.

## Scope

`apps/fm-web/src/components/ui/resizable.tsx` (generated), `apps/fm-web/package.json`, `bun.lock`, `registry.json`, `registry/fm/react/file-manager.tsx`, `registry/fm/react/details-panel.tsx`, `registry/fm/react/labels.ts`, `tests/e2e/fm.spec.ts`, README, changelog.

## Alternatives

- Hand-rolled drag handle with pointer events: no dependency, but no keyboard support, persistence or constraints for free, and not the shadcn baseline.

## Annotations

(none)

## As built

- `apps/fm-web`: shadcn `resizable` (base-nova) added; `react-resizable-panels` pinned to 4.17.0.
- `registry.json` `fm-react`: `resizable` in `registryDependencies`, `react-resizable-panels` in `dependencies` (`file-manager.tsx` imports `useDefaultLayout` directly).
- `file-manager.tsx`: the panel group is always rendered; panels `tree` (split only; 224px default, 160px min, 40% max), `main` (320px min) and `details` (open and not narrow; 288px default, 220px min, 50% max). Narrow containers keep a single `main` panel and the details overlay, so behaviour there is unchanged.
- Sizes persist through `useDefaultLayout` (id `${storageKey}:panels`, one layout per panel combination via `panelIds`); toggling details does not remount the list.
- Handles carry `aria-label` "Resize folder tree" / "Resize details" (zh: 调整目录树宽度 / 调整详情宽度); the 1px separator line replaces the former `border-r` / `border-l`.
- Verified: `bun run check` (219 pass / 1 skip), 33 e2e (new: drag, persistence after reload, arrow key), registry smoke (host gets `resizable` under its own alias).
