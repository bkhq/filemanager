# 20261105-1300-change-message Change messages (commit notes) for writes

- **status**: completed
- **approvedAt**: 2026-11-05 14:00
- **createdAt**: 2026-11-05 13:00
- **relatedTask**: bks adoption (skills: every change is a commit with an optional message)

## Context

- bks stores skill files as commits; its own file browser keeps one "commit message" input above the browser and sends it with every change (blank → the server generates one). Other hosts may want the same (audit notes, managed-store versions later).
- Today nothing carries a message: the client sends no such field, the router's driver calls (`write`, `mkdir`, `move`, `copy`, `remove`) have no context argument, and `FmChangeEvent` has no note.
- `createFmClient` already takes `headers()`; the router already has `onEvent`.

## Proposal

1. **Transport**: an optional message travels as the `X-Fm-Message` header (percent-encoded UTF-8, at most 1 000 characters after decoding; longer → 400) on every changing request: `PUT /write`, `POST /mkdir`, `POST /ops` (all items share it), upload session completion, trash restore / purge.
2. **Router → driver**: driver methods get an optional trailing context `{ message?: string }` (`write` via `FmWriteOptions.message`; `mkdir / move / copy / remove` gain `opts?: FmChangeContext`). Existing drivers ignore it; the contract suite checks they still pass. `FmChangeEvent.message` carries it to `onEvent` (audit).
3. **Client**: `createFmClient({ message?: () => string | undefined })` adds the header to changing requests only; per-call override `client.write(…, { message })` / `ops(…, { message })`.
4. **UI** (`<FileManager changeMessage={…}>`, off by default):
   - `{ mode: "optional" | "required", placeholder? }`: changes ask for a message where the user already confirms something — editor / sheet Save opens a small "Describe the change" popover (Enter saves, empty allowed when optional), rename / new folder / new file / delete / move-to dialogs gain a message field, uploads ask once per batch, drag-and-drop moves and paste prompt once.
   - `{ get: () => string | undefined, onUsed?: () => void }`: the host owns the input (bks keeps its field above the browser); every change sends `get()`, `onUsed` lets the host clear it after a successful change.
   - Labels en / zh.
5. Demo: fm-web toggle "Ask for change messages" (localStorage), messages shown in the API log via `onEvent`. README section.

## Risks

- Driver signature change: optional trailing arguments, so existing hosts' drivers keep compiling; bks implements it in its skill driver.
- Prompting on every change is heavy; the default stays off and "optional" lets users skip with Enter.

## Scope

`server/driver.ts`, `server/router.ts` (+ tests), `server/contract.ts`, drivers (signature only), `core/schema.ts` (event type), `client/client.ts` (+ tests), `react/file-manager.tsx`, `react/dialogs.tsx`, `react/text-preview.tsx`, `plugins/sheet-view.tsx`, labels, `apps/fm-api` / `apps/fm-web` demo, README, e2e.

## Verification

Router tests (header decoded and passed to each driver call and to `onEvent`, length limit, absent header → undefined), client tests (header only on changing calls, override), contract suite unchanged on all drivers, e2e (required mode blocks Save until a message is typed and the API receives it; host `get` mode sends the field's value on rename and delete; default mode shows no prompts).

## Annotations

2026-11-05: user approved ("go") together with 20261105-1400-review-changes.

## As built

- Server: `X-Fm-Message` (percent-encoded, ≤ 1 000 chars, else 400) → `FmChangeContext { message }` on `write` (in `FmWriteOptions`), `mkdir / move / copy / remove` (optional trailing argument), also for trash moves / restore / purge and upload completion; `FmChangeEvent.message` for `onEvent`. Internal housekeeping writes (upload records, trash metadata) carry no message.
- Client: `createFmClient({ message })`, per-call `{ message }` on `write / mkdir / ops / restore / purge / completeUpload`, `changeHeaders()` for XHR uploads; upload tasks carry a `message`.
- UI: `changeMessage` prop. `mode` shows one "Describe the change" prompt before each change (deviation from the plan: one shared prompt instead of extra fields in each dialog — same for rename, new file / folder, delete, move, paste, drop, upload batches, undo, trash restore / purge, editor and sheet Save); cancel aborts the change, `required` blocks empty notes. `get` / `onUsed`: the built-in client reads the host's note, `used()` runs after each successful change. Context `useChangeMessage()` for previews and plugins.
- Demo: "Ask for change notes" checkbox (`?ask=required` for the required mode); fm-api logs notes from `onEvent`.
- Verified: router / client tests, `bun run check`, `registry:smoke`, e2e 79/79 (required prompt, header sent, cancel aborts).
