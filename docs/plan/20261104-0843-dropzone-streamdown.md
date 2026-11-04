# 20261104-0843-dropzone-streamdown Dropzone uploads, streamdown live preview, dependency catalog

- **status**: completed
- **createdAt**: 2026-11-04 08:43
- **approvedAt**: 2026-11-04 08:43
- **relatedTask**: 20261104-0843-dropzone-streamdown

## Context

- Uploads: tree toolbar menu, "Upload here" on folders, list toolbar, and a hand-written section drop handler (`file-manager.tsx` onDragOver / onDrop + `react/drop.ts` walking `webkitGetAsEntry`).
- Markdown plugin (`plugins/markdown-view.tsx`) renders with react-markdown + remark-gfm + shiki; source / preview toggle only, the preview shows the saved text.
- `@nsio/nsl` is a root devDependency while both dev scripts run `bunx nsl`; `nsl` is installed globally. Without the dependency `bunx nsl` would fetch an unrelated npm package `nsl`.
- Only `shadcn` appears in two packages (root devDependency, fm-web dependency).
- Latest: react-dropzone 20.1.4, streamdown 2.7.1 (GFM, rehype-sanitize / rehype-harden built in; hosts add a Tailwind `@source`), @streamdown/code 2.0.0 (shiki highlighting).

## Proposal

1. Dependencies: remove `@nsio/nsl` (scripts call `nsl`; README notes the global install); root `catalog` with `shadcn`, both packages use `catalog:`; add react-dropzone, streamdown, @streamdown/code (exact) to fm-web; drop react-markdown, remark-gfm, shiki; update registry items (fm-react: react-dropzone; fm-plugin-markdown: streamdown, @streamdown/code) and README (`@source`).
2. Uploads with `useDropzone`: section drop overlay uploads to the current folder (folders flattened with relative paths by file-selector); the empty state gets a "drop or click" area; folder upload keeps the `webkitdirectory` input.
3. Markdown: source (default) / preview / preview to the side (live, follows the editor text including unsaved edits) via `TextPreview` `onTextChange`; rendering with `<Streamdown>` + `@streamdown/code`.

## Risks

- Hosts using the Markdown plugin must add the streamdown `@source` lines.
- file-selector folder handling differs from the old walker; covered by e2e.

## Scope

Root and fm-web `package.json`, `bun.lock`, `registry.json`, `registry/fm/react/file-manager.tsx`, `react/drop.ts`, `react/text-preview.tsx`, `react/previewers.tsx` (props), `react/labels.ts`, `plugins/markdown-view.tsx`, `apps/fm-web/src/index.css`, README, e2e.

## Alternatives

- Keep the hand-written drop handler: no dependency, no click-to-upload area, more code.

## Annotations

2026-11-04: user approved ("ok").

## As built

- `@nsio/nsl` removed; dev scripts call the global `nsl`. Root `catalog` pins `shadcn` (root + fm-web use `catalog:`). fm-web adds react-dropzone 20.1.4, streamdown 2.7.1, @streamdown/code 2.0.0; react-markdown, remark-gfm, shiki dropped.
- Section is a `useDropzone` root (`noClick`, `noKeyboard`, `noPaste`, disabled without upload). `onKeyDown` is passed outside `getRootProps` (with `noKeyboard` it is dropped), `aria-disabled` is cleared (read-only would otherwise mark the whole section disabled) and `role` stays `region`. `drop.ts` maps file-selector `relativePath` / `path` to upload paths.
- Explorer empty preview shows a dashed "Drop files here or click to upload" button.
- Markdown: header buttons "Open preview" / "Reopen as source" and "Open preview to the side"; the preview follows the editor via `PreviewProps.onTextChange`. Rendered with `<Streamdown mode="static" plugins={{ code }}>`.
- Verified: `bun run check` (243 tests), `registry:smoke`, e2e 60/60 (new: side preview follows unsaved edits, OS file drop, empty-state click upload).
