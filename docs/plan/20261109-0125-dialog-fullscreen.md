# 20261109-0125-dialog-fullscreen Full-screen preview dialogs

- **status**: completed
- **createdAt**: 2026-11-09 01:25
- **approvedAt**: 2026-11-09 01:25
- **relatedTask**: 20261109-0125-dialog-fullscreen

## Context

`react/preview-dialog.tsx` and `react/review-dialog.tsx` are fixed at 85vh and a maximum width. The other dialogs are small confirmations and name prompts.

## Proposal

A shared `MaximizeButton` and `MAXIMIZED_DIALOG` classes (`react/dialog-maximize.tsx`): the dialog fills the browser window. CSS rather than the Fullscreen API, so portalled toasts and nested dialogs keep working. The state lives in the dialog, so it survives previous / next.

## Risks

The image stage changes size while open; it has to refit and stay centred.

## Scope

`react/dialog-maximize.tsx` (new), both dialogs, `react/labels.ts`, `registry.json`, `tests/e2e/image.spec.ts`, changelog.

## Verification

e2e: the dialog fills the window, the image refits centred, the state survives Next, and exit restores it. Typecheck, lint, unit tests.

## Annotations

- The toggle is instant (`transition-none`): the dialog's `duration-100` animated height and position while `max-width` jumped, which jittered. The open / close fade is a CSS animation and stays.
