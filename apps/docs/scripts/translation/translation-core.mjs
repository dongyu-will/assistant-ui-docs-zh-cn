const PROTECTED_TOKEN_PATTERN_SOURCE =
  "\\u27e6AUI_(?:SOURCE|CURRENT)_\\d{4}\\u27e7";

function tokenNumber(value) {
  return String(value).padStart(4, "0");
}

function maskPattern(text, pattern, addFragment) {
  return text.replace(pattern, (match) => addFragment(match));
}

function maskJsxTagKeepingDisplayStrings(fragment, addFragment) {
  const displayStringPattern =
    /\b(?:description|label|title)\s*(?::|=)\s*(["'])((?:\\.|[^\\])*?)\1/g;
  const matches = [...fragment.matchAll(displayStringPattern)];
  if (matches.length === 0) return addFragment(fragment);

  let result = "";
  let cursor = 0;
  for (const match of matches) {
    const content = match[2];
    const contentStart = match.index + match[0].length - content.length - 1;
    const fixed = fragment.slice(cursor, contentStart);
    if (fixed) result += addFragment(fixed);
    result += content;
    cursor = contentStart + content.length;
  }
  const remainder = fragment.slice(cursor);
  if (remainder) result += addFragment(remainder);
  return result;
}

function maskJsxTags(text, addFragment) {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start === -1) {
      result += text.slice(cursor);
      break;
    }

    result += text.slice(cursor, start);
    const next = text[start + 1];
    const tagStart = /[A-Za-z/]/.test(next ?? "");
    if (!tagStart) {
      result += "<";
      cursor = start + 1;
      continue;
    }

    let quote = null;
    let braces = 0;
    let end = start + 1;
    for (; end < text.length; end += 1) {
      const character = text[end];
      const previous = text[end - 1];

      if (quote) {
        if (character === quote && previous !== "\\") quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "{") braces += 1;
      if (character === "}") braces = Math.max(0, braces - 1);
      if (character === ">" && braces === 0) break;
    }

    if (end >= text.length) {
      result += text.slice(start);
      break;
    }

    result += maskJsxTagKeepingDisplayStrings(
      text.slice(start, end + 1),
      addFragment,
    );
    cursor = end + 1;
  }

  return result;
}

function maskBracedExpressions(text, addFragment) {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("{", cursor);
    if (start === -1) {
      result += text.slice(cursor);
      break;
    }

    result += text.slice(cursor, start);
    let depth = 0;
    let quote = null;
    let end = start;
    for (; end < text.length; end += 1) {
      const character = text[end];
      const previous = text[end - 1];

      if (quote) {
        if (character === quote && previous !== "\\") quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "{") depth += 1;
      if (character === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    if (end >= text.length) {
      result += text.slice(start);
      break;
    }

    result += addFragment(text.slice(start, end + 1));
    cursor = end + 1;
  }

  return result;
}

export function protectMdx(mdx, prefix = "SOURCE") {
  const fragments = new Map();
  let sequence = 0;
  const addFragment = (fragment) => {
    const token = `⟦AUI_${prefix}_${tokenNumber(sequence)}⟧`;
    sequence += 1;
    fragments.set(token, fragment);
    return token;
  };

  // Mask Markdown link destinations before URLs so the model always sees balanced link syntax.
  let masked = mdx.replace(
    /(\]\()([^\s)]+(?:\s+["'][^"']*["'])?)(\))/g,
    (_match, open, destination, close) =>
      `${open}${addFragment(destination)}${close}`,
  );
  masked = masked.replace(
    /^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/gm,
    (_match, lead, destination, tail) =>
      `${lead}${addFragment(destination)}${tail}`,
  );
  masked = masked.replace(/https?:\/\/[^\s<>"'`]+/g, addFragment);
  masked = maskPattern(
    masked,
    /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g,
    addFragment,
  );
  masked = maskPattern(
    masked,
    /^(?:import|export)\s[\s\S]*?(?=\n\s*\n|$)/gm,
    addFragment,
  );
  masked = maskPattern(masked, /(`+)(?!`)([^\n]*?)\1/g, addFragment);
  masked = maskJsxTags(masked, addFragment);
  masked = maskBracedExpressions(masked, addFragment);
  fragments.topLevelTokens =
    masked.match(new RegExp(PROTECTED_TOKEN_PATTERN_SOURCE, "g")) ?? [];
  return { masked, fragments };
}

export function restoreProtectedMdx(candidate, fragments) {
  const seenTokens =
    candidate.match(new RegExp(PROTECTED_TOKEN_PATTERN_SOURCE, "g")) ?? [];
  const topLevelTokens = fragments.topLevelTokens ?? [...fragments.keys()];
  const expectedTopLevelTokens = new Set(topLevelTokens);
  const unexpected = seenTokens.filter(
    (token) => !expectedTopLevelTokens.has(token),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Model output contains unexpected protected tokens: ${[...new Set(unexpected)].join(", ")}`,
    );
  }

  for (const token of topLevelTokens) {
    const occurrences = seenTokens.filter((value) => value === token).length;
    if (occurrences !== 1) {
      throw new Error(
        `Protected token ${token} occurred ${occurrences} times; expected exactly once`,
      );
    }
  }

  let restored = candidate;
  const replacementCounts = new Map();
  while (true) {
    const match = restored.match(new RegExp(PROTECTED_TOKEN_PATTERN_SOURCE));
    if (!match) break;
    const token = match[0];
    const fragment = fragments.get(token);
    if (fragment === undefined) {
      throw new Error(
        `Model output contains unknown protected token: ${token}`,
      );
    }
    const count = (replacementCounts.get(token) ?? 0) + 1;
    if (count > 1) {
      throw new Error(
        `Protected token ${token} was duplicated during restoration`,
      );
    }
    replacementCounts.set(token, count);
    restored = restored.replace(token, () => fragment);
  }

  const unrestored = [...fragments.keys()].filter(
    (token) => replacementCounts.get(token) !== 1,
  );
  if (unrestored.length > 0) {
    throw new Error(
      `Protected fragments were not restored: ${unrestored.join(", ")}`,
    );
  }
  return restored;
}

export function normalizeModelOutput(output) {
  const trimmed = output.trim();
  const fenced = trimmed.match(/^```(?:mdx|markdown)?\s*\n([\s\S]*)\n```$/i);
  return (fenced?.[1] ?? trimmed).trimEnd() + "\n";
}

function frontmatterKeys(mdx) {
  const match = mdx.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!match) return [];
  return [...match[1].matchAll(/^([A-Za-z][\w-]*):/gm)]
    .map((item) => item[1])
    .sort();
}

function jsxTagNames(mdx) {
  return [...mdx.matchAll(/<\/?([A-Za-z][\w.-]*)\b/g)].map((item) => item[1]);
}

function fencedBlocks(mdx) {
  return [
    ...mdx.matchAll(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g),
  ].map((item) => item[0]);
}

function esmBlocks(mdx) {
  const withoutFences = mdx.replace(
    /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g,
    "",
  );
  return [
    ...withoutFences.matchAll(/^(?:import|export)\s[\s\S]*?(?=\n\s*\n|$)/gm),
  ].map((item) => item[0]);
}

function inlineCode(mdx) {
  const withoutFences = mdx.replace(
    /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g,
    "",
  );
  return [...withoutFences.matchAll(/(`+)(?!`)([^\n]*?)\1/g)].map(
    (item) => item[0],
  );
}

function urls(mdx) {
  return [...mdx.matchAll(/https?:\/\/[^\s<>"'`]+/g)]
    .map((item) => item[0])
    .sort();
}

function sameList(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function replaceSequential(text, pattern, replacements) {
  let index = 0;
  return text.replace(pattern, (match) => {
    if (index >= replacements.length) return match;
    return replacements[index++];
  });
}

function transformOutsideFences(text, transform) {
  const pattern = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    result += transform(text.slice(cursor, match.index));
    result += match[0];
    cursor = match.index + match[0].length;
  }
  return result + transform(text.slice(cursor));
}

/**
 * Recover source-owned structure when a model changed it despite masking.
 * Only equal-length sequences are repaired; prose and ordering are untouched.
 */
export function repairTranslatedStructure(sourceMdx, translatedMdx) {
  let repaired = translatedMdx;
  const sourceFences = fencedBlocks(sourceMdx);
  const candidateFences = fencedBlocks(repaired);
  if (sourceFences.length === candidateFences.length) {
    repaired = replaceSequential(
      repaired,
      /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g,
      sourceFences,
    );
  }

  const sourceEsm = esmBlocks(sourceMdx);
  const candidateEsm = esmBlocks(repaired);
  if (sourceEsm.length === candidateEsm.length) {
    repaired = replaceSequential(
      repaired,
      /^(?:import|export)\s[\s\S]*?(?=\n\s*\n|$)/gm,
      sourceEsm,
    );
  }

  const sourceInline = inlineCode(sourceMdx);
  const candidateInline = inlineCode(repaired);
  if (sourceInline.length === candidateInline.length) {
    let index = 0;
    repaired = transformOutsideFences(repaired, (text) =>
      text.replace(/(`+)(?!`)([^\n]*?)\1/g, () => sourceInline[index++]),
    );
  } else {
    const required = new Map();
    for (const value of sourceInline) {
      required.set(value, (required.get(value) ?? 0) + 1);
    }
    const candidateCounts = new Map();
    for (const value of candidateInline) {
      candidateCounts.set(value, (candidateCounts.get(value) ?? 0) + 1);
    }
    const sourceIsSubset = [...required].every(
      ([value, count]) => (candidateCounts.get(value) ?? 0) >= count,
    );
    if (sourceIsSubset) {
      repaired = transformOutsideFences(repaired, (text) =>
        text.replace(/(`+)(?!`)([^\n]*?)\1/g, (match, _ticks, content) => {
          const remaining = required.get(match) ?? 0;
          if (remaining > 0) {
            required.set(match, remaining - 1);
            return match;
          }
          return content;
        }),
      );
    }
  }

  const sourceUrls = urls(sourceMdx);
  const candidateUrls = urls(repaired);
  if (sourceUrls.length === candidateUrls.length) {
    repaired = replaceSequential(
      repaired,
      /https?:\/\/[^\s<>"'`]+/g,
      sourceUrls,
    );
  }

  const sourceTags = jsxTagNames(sourceMdx);
  const candidateTags = jsxTagNames(repaired);
  if (sourceTags.length === candidateTags.length) {
    let index = 0;
    repaired = repaired.replace(
      /(<\/?)([A-Za-z][\w.-]*)\b/g,
      (match, open, name) => {
        const replacement = sourceTags[index++];
        return replacement ? `${open}${replacement}` : `${open}${name}`;
      },
    );
  }
  return repaired;
}

export function validateTranslatedMdx(
  sourceMdx,
  translatedMdx,
  { requireChinese = true } = {},
) {
  const errors = [];
  const comparisons = [
    [
      "frontmatter keys",
      frontmatterKeys(sourceMdx),
      frontmatterKeys(translatedMdx),
    ],
    ["JSX tag names", jsxTagNames(sourceMdx), jsxTagNames(translatedMdx)],
    ["ESM blocks", esmBlocks(sourceMdx), esmBlocks(translatedMdx)],
    [
      "fenced code blocks",
      fencedBlocks(sourceMdx),
      fencedBlocks(translatedMdx),
    ],
    [
      "inline code",
      inlineCode(sourceMdx).sort(),
      inlineCode(translatedMdx).sort(),
    ],
    ["absolute URLs", urls(sourceMdx), urls(translatedMdx)],
  ];

  for (const [label, sourceValues, translatedValues] of comparisons) {
    if (!sameList(sourceValues, translatedValues))
      errors.push(`${label} changed`);
  }
  if (requireChinese && !/\p{Script=Han}/u.test(translatedMdx)) {
    errors.push("output contains no Chinese text");
  }
  if (translatedMdx.includes("⟦AUI_"))
    errors.push("output contains an unresolved protected token");

  return { ok: errors.length === 0, errors };
}

function splitMdxAtHeadingLevels(mdx, levels) {
  const lines = mdx.match(/.*(?:\n|$)/g)?.filter(Boolean) ?? [];
  const sections = [];
  let current = [];
  let fence = null;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (
        marker[0] === fence.character &&
        marker.length >= fence.length
      ) {
        fence = null;
      }
    }

    const heading = !fence ? line.match(/^(#{2,3})\s+\S/) : null;
    if (heading && levels.has(heading[1].length) && current.join("").trim()) {
      sections.push(current.join(""));
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) sections.push(current.join(""));
  return sections;
}

export function splitMdxByHeadings(mdx, { maxSectionBytes = 8_000 } = {}) {
  const primarySections = splitMdxAtHeadingLevels(mdx, new Set([2]));
  return primarySections.flatMap((section) => {
    if (Buffer.byteLength(section) <= maxSectionBytes) return [section];
    return splitMdxAtHeadingLevels(section, new Set([3]));
  });
}

export function preparePageTranslation({
  sourceMdx,
  currentChineseMdx = null,
  sourceDiff = "",
  glossary = "",
}) {
  const source = protectMdx(sourceMdx, "SOURCE");
  const current = currentChineseMdx
    ? protectMdx(currentChineseMdx, "CURRENT")
    : null;
  const mode = current ? "update" : "initial";

  const instructions = [
    "你是 assistant-ui 技术文档翻译器。将整个 MDX 页面翻译为简体中文。",
    "只返回完整 MDX，不要包裹 Markdown 代码围栏，不要解释。",
    "翻译正文、标题、可见链接文字、title 和 description 等展示文案。",
    "不得改动、重排、删除或复制任何 ⟦AUI_SOURCE_0000⟧ 形式的占位符；每个 SOURCE 占位符必须恰好出现一次。",
    "不要输出任何 CURRENT 占位符。保持 MDX 层级、列表、表格和空行结构。",
    "保留 assistant-ui、React、Next.js、Fumadocs、OpenAI、Anthropic、LangGraph、MCP、A2UI、Slack、Microsoft Teams 等产品、协议和平台专有名词；首次出现时可在正文补充中文解释，但不要翻译名称本身。",
    "保留所有 API 名、类型、标识符、包名、命令和路由。遵循提供的术语表：专有名词优先原样保留，通用技术术语统一翻译。中文应准确、简洁、符合中文技术文档习惯。",
  ].join("\n");

  const sections = [
    `<task>${mode === "initial" ? "initial_translation" : "update_translation"}</task>`,
    `<english_mdx>\n${source.masked}\n</english_mdx>`,
  ];

  if (current) {
    sections.push(
      "<update_instruction>尽量保留现有中文译文中的人工修订和术语，只根据新英文页面和差异更新必要内容。输出必须使用 SOURCE 占位符。</update_instruction>",
      `<current_chinese_mdx>\n${current.masked}\n</current_chinese_mdx>`,
    );
    if (sourceDiff)
      sections.push(`<upstream_diff>\n${sourceDiff}\n</upstream_diff>`);
  }
  if (glossary)
    sections.push(
      `<terminology_glossary>\n${glossary}\n</terminology_glossary>`,
    );

  return {
    mode,
    instructions,
    input: sections.join("\n\n"),
    sourceFragments: source.fragments,
    protectedFragmentCount: source.fragments.size,
  };
}
