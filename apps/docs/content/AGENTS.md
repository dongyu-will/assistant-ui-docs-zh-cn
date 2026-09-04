# Chinese documentation

This branch is an unofficial Simplified Chinese reading layer for the official assistant-ui documentation.

## Translation contract

- Treat `upstream/main` as the English source of truth. Keep file paths, route slugs, imports, exports, JSX structure, expressions, code blocks, inline code, URLs, package names, API names, and identifiers unchanged.
- Translate reader-visible prose, headings, link labels, and display fields such as `title`, `description`, and `label` into concise Simplified Chinese.
- Keep each translated MDX file Chinese-only. Do not interleave the English source or create a parallel English copy in this branch.
- Translate one complete page per model request. Use heading-level splitting only when the configured API cannot accept the full page, then assemble one ordinary MDX file before review.
- Run the repository translation command so protected fragments are validated before a file is written. A failed validation leaves the destination unchanged.
- Preserve the official page hierarchy and Fumadocs components. Put site-wide attribution and the Official Original link in shared UI, not repeated prose inside every page.

## Workflow

For initial translation, update translation, upstream synchronization, and acceptance checks, read [`../translation/README.md`](../translation/README.md). A page is complete when its protected structure passes translation tests and the official docs application can render it.
