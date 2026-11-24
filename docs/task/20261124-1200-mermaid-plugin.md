# 20261124-1200-mermaid-plugin Mermaid plugin: .mmd previews and diagrams in Markdown

- **status**: completed
- **priority**: P2
- **owner**: claude
- **createdAt**: 2026-11-24 12:00

## Description

Previews stay one component per file type: built-ins (image, SVG, media, PDF, text) in `fm-react`, optional ones as plugin registry items. Mermaid becomes one more plugin, and a plugin can now add to the Markdown preview without the Markdown plugin depending on it.

- `FmPlugin.codeRenderers` (new): fenced code blocks of the given languages render with a plugin component. The Markdown preview collects them from every plugin (`PreviewProps.codeRenderers`).
- `SourcePreview` (new, `fm-react`): the text editor with a rendered view instead of it or beside it, following unsaved edits. The Markdown preview moves onto it; plugins for other text formats reuse it.
- `fm-plugin-mermaid` / `mermaidPlugin()`: `.mmd` / `.mermaid` files open as the diagram with a source toggle; ```` ```mermaid ```` blocks in Markdown render as diagrams. `mermaid` loads on first use and follows the light / dark theme.
- Built-in previews (image, PDF, media) stay in `fm-react`: no dependencies to save.

## ActiveForm

Adding the Mermaid plugin

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Approved in chat, no separate plan. Demo seeds `samples/flow.mmd` and `samples/diagram.md`; e2e `fm.spec.ts` "draws Mermaid files and Mermaid blocks in Markdown". The rendered pane's test hook is now `data-fm-rendered` (was `data-fm-markdown-preview`).
