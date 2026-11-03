# Chinese documentation workflow

The default `main` branch of `dongyu-will/assistant-ui-docs-zh-cn` keeps the official assistant-ui repository and replaces selected reader-facing MDX content with an unofficial Simplified Chinese translation. The official repository is the read-only English source; configure it as `upstream` in each clone:

```bash
git remote add upstream https://github.com/assistant-ui/assistant-ui.git
git fetch upstream main
```

If `upstream` already exists, check `git remote -v` before fetching. Create maintenance branches from this repository's `main`; the old `zh-cn` branch name is no longer the default.

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

For a manually reviewed translation, pass `--candidate-input /absolute/path/to/candidate.mdx` to the same command. Prepare the candidate from `protectMdx(source).masked`, keeping every SOURCE placeholder exactly once. This uses the same restoration, validation, and atomic write path without an API request or key. Read back the written page and compare all links and each API table row with the English source; passing structural validation alone does not establish semantic accuracy.

When translating a heading, preserve its English anchor with Fumadocs' `[#original-slug]` suffix, especially when another page links to it. For example, `## 在编辑器中查看 [#in-your-editor]` keeps `/docs/runtimes/concepts/stability#in-your-editor` working.

## Verify

```bash
pnpm -C apps/docs test:translation
pnpm -C apps/docs build:zh
```

Run these commands from the repository root. `build:zh` builds the workspace dependencies and the Chinese docs target used by this fork. The full official application can also be checked with `pnpm -C apps/docs build` when that is the intended scope.

Before publishing a batch, review terminology, technical meaning, negation and conditions, code-to-prose correspondence, internal links, desktop rendering, and narrow-screen overflow.

## Follow upstream

Fetch the official source with `git fetch upstream main`, record the exact source commit, and compare it with the last fully integrated upstream commit:

```bash
git merge-base main upstream/main
git diff --name-status --find-renames <last-full-upstream-commit> <source-commit> -- apps/docs/content
```

Review directory moves together with sidebar metadata, redirects, imports, and component/API dependencies. A full merge of `upstream/main` belongs in a dedicated sync change after those dependencies are checked. Preserve this fork's Chinese translations, attribution, SEO, `build:zh`, and deployment configuration when resolving conflicts.

For a partial batch, use the per-page update command above and state which pages were synchronized and which source commit they use. A partial batch does not advance the full-merge baseline. `translate:batch` skips existing Chinese pages and is intended for initial translation; it does not refresh previously translated pages. New pages enter the translation queue, and removed or moved pages need explicit review before deletion. Git is the translation history; do not introduce a translation-unit database unless contributor volume later creates a demonstrated need.

## Partial sync: 2026-11-03

- Last fully integrated upstream commit: `a722971700f43d52bc0110e09a1b3c4f092d6ed8` (2026-09-03).
- Reviewed English source: `805176a223f9494fb607522fc9e344f63d78db35` (2026-11-03).
- Updated complete pages: `content/docs/runtimes/concepts/stability.mdx` and `content/docs/migrations/deprecation-policy.mdx`.
- Scope: repair the stability page's mismatched API identifiers and package/description associations, explain experimental editor tags and `unstable_Provider` deprecation, and align the experimental API removal policy. Preserve the English heading anchors in both translated pages.
- Remaining scope: the source is 2,190 upstream commits ahead of the full baseline. Across `apps/docs/content`, a comparison with rename detection disabled lists 335 modified MDX paths (including these two pages), 247 added paths, and 34 deleted paths. These are path counts, not a count of independent pages; directory moves account for some additions and deletions.
- Next batches should review the runtime concepts together with the corresponding runtime implementation, and handle Cloud, Vue, React Native, store/tap, and the getting-started directory migrations with their navigation and redirects. This batch does not merge the upstream code or claim a full synchronization.
