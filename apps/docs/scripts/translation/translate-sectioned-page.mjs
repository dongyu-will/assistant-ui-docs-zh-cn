#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  normalizeModelOutput,
  preparePageTranslation,
  repairTranslatedStructure,
  restoreProtectedMdx,
  splitMdxByHeadings,
  validateTranslatedMdx,
} from "./translation-core.mjs";
import {
  requestTranslation,
  translationApiConfigFromEnv,
} from "./translation-api.mjs";

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function validateSectionCandidate(sourceMdx, prepared, output) {
  const normalized = normalizeModelOutput(output);
  let translated = restoreProtectedMdx(normalized, prepared.sourceFragments);
  let validation = validateTranslatedMdx(sourceMdx, translated, {
    requireChinese: false,
  });
  if (!validation.ok) {
    translated = repairTranslatedStructure(sourceMdx, translated);
    validation = validateTranslatedMdx(sourceMdx, translated, {
      requireChinese: false,
    });
  }
  if (!validation.ok) {
    throw new Error(
      `Translation validation failed: ${validation.errors.join("; ")}`,
    );
  }
  return translated;
}

async function translateSection({
  sourceMdx,
  glossary,
  config,
  index,
  total,
  rejectedOutputPath,
}) {
  const prepared = preparePageTranslation({ sourceMdx, glossary });
  const instructions = [
    prepared.instructions,
    `当前输入是同一 MDX 页面的第 ${index + 1}/${total} 个章节。只输出这个章节的完整 MDX；不要添加或重复其他章节。`,
  ].join("\n");

  const firstOutput = await requestTranslation({
    instructions,
    input: prepared.input,
    config,
  });
  try {
    return validateSectionCandidate(sourceMdx, prepared, firstOutput);
  } catch (firstError) {
    const repairInstructions = [
      instructions,
      "上一版输出未通过结构校验。请只根据 english_mdx 从头重新翻译并输出这个完整章节；不要猜测、复制或补写任何代码。",
      "逐字保留所有 SOURCE 占位符；不要给占位符添加反引号或代码围栏。不要解释。",
    ].join("\n");
    const repairInput = [
      prepared.input,
      `<validation_error>${firstError.message}</validation_error>`,
    ].join("\n\n");
    try {
      const repairedOutput = await requestTranslation({
        instructions: repairInstructions,
        input: repairInput,
        config,
      });
      try {
        return validateSectionCandidate(sourceMdx, prepared, repairedOutput);
      } catch (repairError) {
        await atomicWrite(
          `${rejectedOutputPath}.first.mdx`,
          normalizeModelOutput(firstOutput),
        );
        await atomicWrite(
          `${rejectedOutputPath}.repair.mdx`,
          normalizeModelOutput(repairedOutput),
        );
        firstError.message += `; repair attempt failed: ${repairError.message}`;
        throw firstError;
      }
    } catch (repairError) {
      if (repairError.message.startsWith("Translation validation failed:")) {
        throw repairError;
      }
      firstError.message += `; repair attempt failed: ${repairError.message}`;
      throw firstError;
    }
  }
}

async function main() {
  const commandArguments = process.argv.slice(2);
  if (commandArguments[0] === "--") commandArguments.shift();
  const { values } = parseArgs({
    args: commandArguments,
    options: {
      source: { type: "string", short: "s" },
      output: { type: "string", short: "o" },
      glossary: { type: "string" },
      "cache-dir": { type: "string", default: "translation/.section-cache" },
      "max-section-bytes": { type: "string", default: "8000" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });

  if (!values.source || !values.output) {
    throw new Error(
      "Usage: node translate-sectioned-page.mjs --source <english.mdx> --output <chinese.mdx> [--glossary <terms.md>]",
    );
  }

  const sourcePath = resolve(values.source);
  const outputPath = resolve(values.output);
  const sourceMdx = await readFile(sourcePath, "utf8");
  const glossary = values.glossary
    ? await readFile(resolve(values.glossary), "utf8")
    : "";
  const maxSectionBytes = Number(values["max-section-bytes"]);
  if (!Number.isInteger(maxSectionBytes) || maxSectionBytes < 1) {
    throw new Error("--max-section-bytes must be a positive integer");
  }
  const sections = splitMdxByHeadings(sourceMdx, { maxSectionBytes });
  const pageCacheKey = createHash("sha256")
    .update("sectioned-translation-v2\0")
    .update(String(maxSectionBytes))
    .update("\0")
    .update(sourceMdx)
    .update("\0")
    .update(glossary)
    .digest("hex");
  const pageCacheDirectory = resolve(values["cache-dir"], pageCacheKey);

  if (values["dry-run"]) {
    process.stdout.write(
      `${JSON.stringify(
        {
          source: sourcePath,
          output: outputPath,
          sections: sections.length,
          sectionBytes: sections.map((section) => Buffer.byteLength(section)),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const config = translationApiConfigFromEnv();
  const translatedSections = [];
  for (const [index, section] of sections.entries()) {
    const cachePath = resolve(
      pageCacheDirectory,
      `${String(index).padStart(4, "0")}.mdx`,
    );
    if (await fileExists(cachePath)) {
      const cached = await readFile(cachePath, "utf8");
      const cachedValidation = validateTranslatedMdx(section, cached, {
        requireChinese: false,
      });
      if (cachedValidation.ok) {
        process.stdout.write(
          `[cached ${index + 1}/${sections.length}] ${sourcePath}\n`,
        );
        translatedSections.push(cached);
        continue;
      }
    }
    process.stdout.write(
      `[section ${index + 1}/${sections.length}] ${sourcePath}\n`,
    );
    try {
      const translated = await translateSection({
        sourceMdx: section,
        glossary,
        config,
        index,
        total: sections.length,
        rejectedOutputPath: `${cachePath}.rejected`,
      });
      await atomicWrite(cachePath, translated);
      translatedSections.push(translated);
    } catch (error) {
      throw new Error(
        `section ${index + 1}/${sections.length}: ${error.message}`,
      );
    }
  }

  const translatedMdx = translatedSections.join("\n");
  const validation = validateTranslatedMdx(sourceMdx, translatedMdx);
  if (!validation.ok) {
    throw new Error(
      `Final page validation failed: ${validation.errors.join("; ")}`,
    );
  }

  await atomicWrite(outputPath, translatedMdx);
  process.stdout.write(`Translated ${sourcePath} -> ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`Sectioned translation failed: ${error.message}\n`);
  process.exitCode = 1;
});
