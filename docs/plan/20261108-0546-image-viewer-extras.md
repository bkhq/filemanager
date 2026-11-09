# 20261108-0546-image-viewer-extras Image preview: minimap, checkerboard, pixel size

- **status**: completed
- **createdAt**: 2026-11-08 05:46
- **approvedAt**: 2026-11-08 05:47
- **relatedTask**: 20261108-0546-image-viewer-extras

## Context

- The image preview (`react/media-stage.tsx`) zooms and pans with `react-zoom-pan-pinch` 4.2.0 over the whole stage, up to 4x the real size (plan 20261107-0950-image-pan-zoom). Toolbar (in the preview header): zoom out, percentage (fit / real size), zoom in, rotate, flip.
- When zoomed into a large image there is no hint of which part is on screen.
- The stage background is `bg-muted/30` (light grey); transparent pixels of PNG / WebP / SVG blend into it.
- The image's natural size is known after load (`natural` state) but not shown; the details panel shows the file size only.
- `react-zoom-pan-pinch` ships a `MiniMap` component (inside `TransformWrapper`, children = what to draw, `width` / `height`, viewport indicator, click / drag to move the view).

## Proposal

1. **Minimap**: `MiniMap` in the stage's bottom-right corner, shown only while zoomed (`transformScale > 1`), drawing the same image (rotated / flipped like the main view), about 160 px on its longer side, with a border and the viewport frame in the primary colour; clicking or dragging in it moves the view. Hidden on containers narrower than 480 px. `aria-hidden` (the zoom controls and keys stay the accessible way).
2. **Checkerboard**: the image box gets a CSS checkerboard background (two `linear-gradient`s, light / dark aware), so transparent areas read as transparent; opaque images cover it entirely. Video keeps its black stage.
3. **Pixel size**: the toolbar shows the natural size ("6000 × 4000") next to the percentage, muted, hidden on narrow containers; it also goes into the percentage button's title.
4. **Labels**: none needed for the size (numbers); the minimap needs none (decorative).

## Risks

- `MiniMap` renders a second copy of the image: the browser reuses the same decoded image (same URL), so no second download.
- The checkerboard is drawn behind the box only, so the area around a fitted image keeps today's background.

## Scope

`registry/fm/react/media-stage.tsx`, `tests/e2e/image.spec.ts`, changelog. No new dependency, prop or export.

## Verification

- e2e: the minimap appears after zooming in and disappears at fit; clicking its far corner moves the main view; the toolbar shows "6000 × 4000" for the generated image; a transparent PNG's box has the checkerboard background.
- `bun run check`, full e2e, `registry:smoke`; screenshots of a zoomed image with the minimap and of a transparent PNG.

## Alternatives

- **Show the size in the details panel only**: no toolbar change, but the preview dialog does not show the details panel.
- **Always-on minimap**: noise at fit, where the whole image is already visible.

## Annotations

- The minimap's copy of the image has an empty `alt` (it is decorative and `aria-hidden`), so lookups by the file name still find one image.
