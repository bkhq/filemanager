# 20261103-0846-naming-conventions Naming conventions for shipped code

- **status**: completed
- **createdAt**: 2026-11-03 08:46
- **approvedAt**: 2026-11-03 08:46
- **relatedTask**: 20261103-0846-naming-conventions

## Context

Hosts copy registry files into their own tree (`src/fm/`), so exported names share the host namespace. Today exported types mix prefixed (`FmClient`, `FmPlugin`) and generic names (`Entry`, `Mount`, `Driver`, `Features`, `Selection`) that are likely to collide with host types. The server factory `createFileManager` shares its name with the React `<FileManager />`, and the backlog already calls it `createFileRouter`. Nothing is published yet, so renaming is still free for hosts.

## Proposal

Rules (added to `docs/architecture.md`):

| Kind | Rule | Examples |
|---|---|---|
| Registry namespace / items | `@bkhq/fm-<area>[-<name>]` | `@bkhq/fm-react`, `@bkhq/fm-driver-s3` |
| Exported types and interfaces under `registry/fm` | `Fm` prefix, except React `*Props` | `FmEntry`, `FmDriver`, `FileManagerProps` |
| Server factory | `createFmRouter`, options `FmRouterOptions` | |
| Client factory / hooks | `createFmClient`, `useXxx` | `useListing`, `useFmMutations` |
| Drivers / plugins | `<name>Driver()`, `<name>Plugin()` | `localDriver`, `sheetPlugin` |
| React components | descriptive, no prefix | `FileManager`, `FilePicker` |
| Values, functions, zod schemas | unchanged camelCase / UPPER_CASE | `entrySchema`, `READ_ONLY_CAPS` |
| Runtime identifiers | `fm` / `fm-` / `FM_` | `.fm-trash`, `application/x-fm-paths`, `FM_DEMO_ROOT` |
| Terms | driver, mount, entry (never provider) | |

Renames (type-aware, via the TypeScript language service, so comments and strings are untouched):

- core: `Action Caps EntryKind Entry MountInfo SortKey ListResult Conflict OpsRequest OpResult OpsResult TrashItem Usage ErrorBody ErrorCode` -> `Fm*`
- server: `Driver DriverEntry ByteRange ReadResult WriteOptions Mount Limits ArchiveLimits DriverFixture` -> `Fm*`; `FileManagerOptions` -> `FmRouterOptions`; `createFileManager` -> `createFmRouter`
- drivers: `LocalDriverOptions MemoryDriverOptions S3DriverOptions` -> `Fm*`
- client: `ListParams WriteParams UploadStatus UploadTask UploadFile Transport UploadState UploadQueueOptions UploadQueue` -> `Fm*`
- react: `Features Labels FileAction ActionContext Previewer Selection SelectMode Clipboard FileKind MediaView Size Undo UploadChoice` -> `Fm*`
- plugins: `SheetTable` -> `FmSheetTable`

Enforcement: `ts/naming-convention` on `registry/fm/**` for exported type-likes (prefix `Fm`, `*Props` exempt).

Docs: README, architecture, smoke script and the open backlog plan use the new names; completed plans and old changelog entries stay as written.

Tracking (same change): recursive-search raised to P1 (it blocks quick-open); publish-registry blocked by this task; bkd-pilot blocked by publish-registry, pick-mode, quick-open and change-events; changelog note that the repository is public.

## Risks

- Breaking rename for any host that already copied the code (none known).
- Regex renames would hit comments and substrings (`Entry` in `DriverEntry`); mitigated by language-service renames.

## Scope

~35 registry files, demo apps, smoke script, eslint config, README, architecture, tracking docs. No behavior change; existing tests, typecheck, build, e2e and registry smoke must pass unchanged.

## Alternatives

- Prefix only host-facing types: fewer renames, but "host-facing" needs judgment and cannot be linted.
- No prefix, rely on import aliases in hosts: zero churn, collisions stay the host problem.

## Annotations

2026-11-03: user accepted the recommended rules (Fm prefix on types, `createFmRouter`) and said go.
