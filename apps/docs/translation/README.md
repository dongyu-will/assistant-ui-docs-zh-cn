# Chinese documentation workflow

The `zh-cn` branch keeps the official assistant-ui repository and replaces selected reader-facing MDX content with an unofficial Simplified Chinese translation. The official repository remains configured as the read-only `upstream` remote.

## Configure the translation API

Copy `.env.translation.example` to `.env.translation.local` and fill in the endpoint, model, and key. The local file is ignored by Git. Both OpenAI-compatible Chat Completions and Responses endpoints are supported.

## Translate one page

From `apps/docs`, run:

```bash
pnpm translate:page -- \
  --source /absolute/path/to/english-page.mdx \
  --output content/docs/runtimes/concepts/threads.mdx \
  --glossary translation/glossary.md
```

The command sends one complete protected MDX page to the configured model. It writes atomically only after imports, exports, JSX tags, code, inline identifiers, URLs, and frontmatter structure pass validation.

For an upstream update, also pass the existing Chinese page and the previous English page:

```bash
pnpm translate:page -- \
  --source /absolute/path/to/new-english-page.mdx \
  --previous-source /absolute/path/to/old-english-page.mdx \
  --current content/docs/runtimes/concepts/threads.mdx \
  --output content/docs/runtimes/concepts/threads.mdx \
  --glossary translation/glossary.md
```

Use `--dry-run` to inspect the request size and selected provider without sending content. Use `--candidate-output` to retain a rejected model response for diagnosis without overwriting the page.

## Verify

```bash
pnpm test:translation
pnpm build
```

Before publishing a batch, review terminology, technical meaning, negation and conditions, code-to-prose correspondence, internal links, desktop rendering, and narrow-screen overflow.

## Follow upstream

Fetch the official source with `git fetch upstream`. Merge `upstream/main` into `zh-cn` in a dedicated sync change. Git is the translation history: changed English pages are reviewed and retranslated, new English pages enter the translation queue, and removed pages are removed from the Chinese branch. Do not introduce a translation-unit database unless contributor volume later creates a demonstrated need.
