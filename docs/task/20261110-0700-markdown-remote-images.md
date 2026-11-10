# 20261110-0700-markdown-remote-images Markdown preview blocks remote images by default

- **status**: completed
- **priority**: P2
- **owner**: BKD campaign l1-9muv8v7b-20261110-0700
- **createdAt**: 2026-11-10 07:00

## Description

S3: streamdown defaults to `allowedImagePrefixes: ["*"]` (`plugins/markdown-view.tsx:21`), so untrusted Markdown can track viewers. Allow same-origin and data URIs by default, with a host opt-in.

## ActiveForm

Markdown preview blocks remote images by default

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: 20261110-0700-filen-audit-fixes.
