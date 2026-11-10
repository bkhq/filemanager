# 20261110-0700-walk-authorize Walks authorize every directory (archive, usage, copy)

- **status**: completed
- **priority**: P1
- **owner**: BKD campaign l1-9muv8v7b-20261110-0700
- **createdAt**: 2026-11-10 07:00

## Description

S1: `/archive`, `/usage`, cross-mount transfer and same-mount copy authorize only the top path (`server/router.ts:541,1122,1160`, `server/archive.ts:20`). Add one shared walk that calls `authorize` per directory; archive / usage / search skip unreadable subtrees; copy and cross-mount move answer FORBIDDEN when the source holds an unreadable subtree; document the `authorize` semantics in `docs/architecture.md`.

## ActiveForm

Walks authorize every directory (archive, usage, copy)

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: 20261110-0700-filen-audit-fixes.
