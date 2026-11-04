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

### Runtime architecture and adapters follow-up

- Source remains `805176a223f9494fb607522fc9e344f63d78db35`; the full-merge baseline above is unchanged.
- Updated complete pages: `content/docs/runtimes/concepts/architecture.mdx` and `content/docs/runtimes/concepts/adapters.mdx`. Preserve the preceding stability/deprecation translations and all Chinese build/deployment customizations.
- Scope: add Eve to the runtime diagram and support matrix; clarify remote thread list composition; align attachment, dictation, feedback, and history adapter contracts, including asynchronous attachment updates, cancellation, history storage scopes, and history write errors. These describe the reviewed upstream API; this documentation-only batch does not backport runtime implementation changes.
- Verification: the normal `translate:page --candidate-input` path validated both complete pages. Direct restoration matched the written files without repair; all 14 code blocks and Markdown link destinations matched the source, both MDX files compiled, and all 17 English heading anchors were retained. Translation tests passed 15/15.
- Validation limits in the cloud executor: `build:zh` completed 25 of 26 dependency tasks, then `tsx` failed to open its local IPC socket (`listen EPERM`). The permitted expanded-execution attempt also failed during runner setup. The Next.js build and browser rendering checks therefore did not run for this follow-up. No build configuration was changed to bypass the restriction.
- The complete docs Vitest suite did not pass: 596 passed and 3 failed, plus three Node-test files were reported as having no Vitest suite. An unchanged-head comparison reproduced the same failures: two CLI-documentation assertions expect English headings in translated content, and one chat-runtime import test timed out. These remain separate validation debt; the dedicated Node translation suite passes.
- Mac follow-up verification (2026-11-03): the same two-page candidate restoration, 14 code blocks, links, and 17 original heading anchors passed. `pnpm -C apps/docs test:translation` passed 15/15, and `pnpm -C apps/docs build:zh` completed all 26 dependency tasks, TypeScript checking, and generation of 260 pages. Desktop and 390px browser checks confirmed the Eve diagram node, the scrollable 13-column adapter matrix without page overflow, and the `#history-adapter` navigation target. The three unresolved JSDoc-link warnings remain in unchanged source.
- On the Mac, `pnpm -C apps/docs test` reported 597 passed and 2 failed, plus the same three Node-test files with no Vitest suite; the chat-runtime import timeout did not recur. An isolated checkout of unchanged PR head `f85bb287fd23c7bce17c02d673343d7d52d77fe4` reproduced both CLI-documentation failures and all three suite-collection errors. No tests or build settings were changed to hide those failures.
- Remaining work includes the thread-management page and the navigation/API integration batches listed above. Do not treat these four synchronized pages as a full upstream synchronization.

### Message editing and branching follow-up

- Source remains `805176a223f9494fb607522fc9e344f63d78db35`; the full-merge baseline is unchanged. Updated complete pages: `content/docs/guides/editing.mdx` and `content/docs/guides/branching.mdx`. The preceding runtime architecture and adapter changes were preserved byte for byte.
- Scope: correct the claim that opening an edit composer cancels an in-progress response. `beginEdit()` opens the editor, and `ActionBarPrimitive.Edit` remains enabled while streaming; applications that want to prevent this must gate editing on `s.thread.isRunning`. Keep the separate edit-and-resubmit, reload, branch-navigation, and runtime capability conditions aligned with the English source.
- Verification: both pages passed `translate:page --candidate-input`, direct protected-fragment restoration without repair, MDX compilation, all 10 original heading anchors, all 5 code blocks, and every Markdown link destination. All linked local documentation routes exist. The generated production HTML includes those anchors and code blocks and the corrected streaming-edit explanation.
- Tests: `pnpm -C apps/docs test:translation` passed 15/15. The existing core suites `src/store/primitive-predicates.test.ts` and `src/tests/default-edit-composer-runtime-core.test.ts` passed 21/21. `pnpm -C apps/docs build:zh` completed all 26 dependency tasks, TypeScript checking, and generation of 260 pages, with the same three unresolved JSDoc-link warnings in unchanged source. `git diff --check` passed. The full docs Vitest suite was not rerun; its baseline failures remain documented in the preceding batch.
- Deferred dependency: the latest thread-management page now links to `/docs/cloud/runtimes`. Its source is `content/docs/cloud/(integrations)/runtimes.mdx`, part of a Cloud directory migration not present in this fork. Review it together with the related Cloud pages, sidebar metadata, and route changes before synchronizing the thread page; this batch adds no unresolved links.
- Remaining scope: six of the original 335 modified MDX paths have now been reviewed against this source across the three batches. Another 329 modified, 247 added, and 34 deleted MDX paths remain to review, including directory moves. The Cloud, Vue, React Native, store/tap, getting-started navigation, and generated API-reference work remains outstanding. These path counts do not imply independent pages or a full upstream synchronization.
