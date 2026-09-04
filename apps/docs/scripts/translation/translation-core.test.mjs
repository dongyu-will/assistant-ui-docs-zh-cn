import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeModelOutput,
  preparePageTranslation,
  repairTranslatedStructure,
  restoreProtectedMdx,
  splitMdxByHeadings,
  validateTranslatedMdx,
} from "./translation-core.mjs";

const source = `---
title: Install assistant-ui
description: Add assistant-ui to an existing project.
platforms: ["react"]
---

import { Callout } from "@/components/callout";

# Installation

Read the [official guide](/docs/guide) and call \`ThreadPrimitive.Root\`.

<Callout type="info">
Run the command below.
</Callout>

\`\`\`bash
pnpm add @assistant-ui/react
\`\`\`
`;

test("prepares and restores one complete protected MDX page", () => {
  const prepared = preparePageTranslation({ sourceMdx: source });
  const modelOutput = prepared.input
    .match(/<english_mdx>\n([\s\S]*?)\n<\/english_mdx>/)[1]
    .replace("Install assistant-ui", "安装 assistant-ui")
    .replace(
      "Add assistant-ui to an existing project.",
      "将 assistant-ui 添加到现有项目。",
    )
    .replace("# Installation", "# 安装")
    .replace("Read the ", "阅读")
    .replace("official guide", "官方指南")
    .replace(" and call ", "，并调用")
    .replace("Run the command below.", "运行以下命令。");

  const translated = restoreProtectedMdx(modelOutput, prepared.sourceFragments);
  assert.equal(validateTranslatedMdx(source, translated).ok, true);
  assert.match(translated, /pnpm add @assistant-ui\/react/);
  assert.match(translated, /<Callout type="info">/);
});

test("protecting and restoring an unchanged page is lossless", () => {
  const prepared = preparePageTranslation({ sourceMdx: source });
  const masked = prepared.input.match(
    /<english_mdx>\n([\s\S]*?)\n<\/english_mdx>/,
  )[1];
  assert.match(masked, /\[official guide\]\(⟦AUI_SOURCE_\d{4}⟧\)/);
  assert.equal(restoreProtectedMdx(masked, prepared.sourceFragments), source);
});

test("restores dollar-sign replacement sequences literally", () => {
  const dollarSource = "Use `$...$`, `$$...$$`, `$&`, and `$'` exactly.\n";
  const prepared = preparePageTranslation({ sourceMdx: dollarSource });
  const masked = prepared.input.match(
    /<english_mdx>\n([\s\S]*?)\n<\/english_mdx>/,
  )[1];
  assert.equal(
    restoreProtectedMdx(masked, prepared.sourceFragments),
    dollarSource,
  );
});

test("rejects a missing protected token", () => {
  const prepared = preparePageTranslation({ sourceMdx: source });
  const firstToken = [...prepared.sourceFragments.keys()][0];
  const candidate = prepared.input
    .match(/<english_mdx>\n([\s\S]*?)\n<\/english_mdx>/)[1]
    .replace(firstToken, "");
  assert.throws(
    () => restoreProtectedMdx(candidate, prepared.sourceFragments),
    /expected exactly once/,
  );
});

test("allows inline identifiers to move with Chinese sentence order", () => {
  const inlineSource = "Call `list()` to read `nextCursor`.\n";
  const prepared = preparePageTranslation({ sourceMdx: inlineSource });
  const [first, second] = [...prepared.sourceFragments.keys()];
  const candidate = prepared.input
    .match(/<english_mdx>\n([\s\S]*?)\n<\/english_mdx>/)[1]
    .replace(first, "⟦TEMP⟧")
    .replace(second, first)
    .replace("⟦TEMP⟧", second);
  const translated = restoreProtectedMdx(candidate, prepared.sourceFragments);
  assert.equal(
    validateTranslatedMdx(inlineSource, `读取${translated}`).ok,
    true,
  );
});

test("detects protected structure drift after restoration", () => {
  const translated = source
    .replace("title:", "heading:")
    .replace("# Installation", "# 安装");
  const result = validateTranslatedMdx(source, translated);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("frontmatter keys changed"));
});

test("normalizes a single outer MDX fence", () => {
  assert.equal(normalizeModelOutput("```mdx\n# 安装\n```"), "# 安装\n");
});

test("exposes display strings inside JSX while protecting the surrounding structure", () => {
  const jsxSource = `<ParametersTable
  type="Adapter"
  parameters={[{ name: "list", description: "Hydrate threads on mount." }]}
/>
`;
  const prepared = preparePageTranslation({ sourceMdx: jsxSource });
  const masked = prepared.input.match(
    /<english_mdx>\n([\s\S]*?)\n<\/english_mdx>/,
  )[1];
  assert.match(masked, /Hydrate threads on mount\./);
  assert.doesNotMatch(masked, /name: "list"/);
  const translated = restoreProtectedMdx(
    masked.replace("Hydrate threads on mount.", "挂载时加载线程。"),
    prepared.sourceFragments,
  );
  assert.match(translated, /description: "挂载时加载线程。"/);
  assert.match(translated, /name: "list"/);
});

test("update requests include the current Chinese page and source diff", () => {
  const prepared = preparePageTranslation({
    sourceMdx: source,
    currentChineseMdx: source.replace("# Installation", "# 安装"),
    sourceDiff: "@@ -1 +1 @@",
  });
  assert.equal(prepared.mode, "update");
  assert.match(prepared.input, /<current_chinese_mdx>/);
  assert.match(prepared.input, /<upstream_diff>/);
});

test("splits page sections at level two and three headings outside code fences", () => {
  const sectioned = `# Page

Intro.

## First

\`\`\`md
## Not a section
\`\`\`

### Detail

Text.
`;
  const sections = splitMdxByHeadings(sectioned, { maxSectionBytes: 40 });
  assert.equal(sections.length, 3);
  assert.match(sections[0], /# Page/);
  assert.match(sections[1], /## Not a section/);
  assert.match(sections[2], /^### Detail/);
});

test("repairs model-added inline code without changing source inline code", () => {
  const inlineSource = "Use `ThreadPrimitive.Root` to render the thread.\n";
  const candidate = "使用 `ThreadPrimitive.Root` 渲染 `thread`。\n";
  const repaired = repairTranslatedStructure(inlineSource, candidate);
  assert.equal(repaired, "使用 `ThreadPrimitive.Root` 渲染 thread。\n");
  assert.equal(validateTranslatedMdx(inlineSource, repaired).ok, true);
});
