#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  normalizeModelOutput,
  preparePageTranslation,
  repairTranslatedStructure,
  restoreProtectedMdx,
  validateTranslatedMdx,
} from "./translation-core.mjs";
import {
  requestTranslation,
  translationApiConfigFromEnv,
} from "./translation-api.mjs";

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sourceDiff(previousSourcePath, sourcePath) {
  if (!previousSourcePath) return "";
  const result = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--no-ext-diff",
      "--unified=3",
      "--",
      previousSourcePath,
      sourcePath,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`Could not create source diff: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

async function main() {
  const commandArguments = process.argv.slice(2);
  if (commandArguments[0] === "--") commandArguments.shift();

  const { values } = parseArgs({
    args: commandArguments,
    options: {
      source: { type: "string", short: "s" },
      output: { type: "string", short: "o" },
      current: { type: "string" },
      "previous-source": { type: "string" },
      glossary: { type: "string" },
      "candidate-input": { type: "string" },
      "candidate-output": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });

  if (!values.source || !values.output) {
    throw new Error(
      "Usage: pnpm translate:page -- --source <english.mdx> --output <chinese.mdx> [--previous-source <old-english.mdx>] [--glossary <terms.md>] [--dry-run]",
    );
  }

  const sourcePath = resolve(values.source);
  const outputPath = resolve(values.output);
  const currentPath = values.current
    ? resolve(values.current)
    : (await fileExists(outputPath))
      ? outputPath
      : null;
  const previousSourcePath = values["previous-source"]
    ? resolve(values["previous-source"])
    : null;
  const glossaryPath = values.glossary ? resolve(values.glossary) : null;
  const candidateOutputPath = values["candidate-output"]
    ? resolve(values["candidate-output"])
    : null;
  const candidateInputPath = values["candidate-input"]
    ? resolve(values["candidate-input"])
    : null;

  const sourceMdx = await readFile(sourcePath, "utf8");
  const currentChineseMdx = currentPath
    ? await readFile(currentPath, "utf8")
    : null;
  const glossary = glossaryPath ? await readFile(glossaryPath, "utf8") : "";
  const diff = sourceDiff(previousSourcePath, sourcePath);
  const prepared = preparePageTranslation({
    sourceMdx,
    currentChineseMdx,
    sourceDiff: diff,
    glossary,
  });
  const config = translationApiConfigFromEnv();

  if (values["dry-run"]) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: prepared.mode,
          source: sourcePath,
          output: outputPath,
          sourceBytes: Buffer.byteLength(sourceMdx),
          protectedFragments: prepared.protectedFragmentCount,
          requestCharacters:
            prepared.instructions.length + prepared.input.length,
          apiFormat: config.format,
          apiUrl: config.apiUrl,
          model: config.model ?? null,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const rawOutput = candidateInputPath
    ? await readFile(candidateInputPath, "utf8")
    : await requestTranslation({
        instructions: prepared.instructions,
        input: prepared.input,
        config,
      });
  const validateCandidate = (output) => {
    const normalized = normalizeModelOutput(output);
    let translated = restoreProtectedMdx(normalized, prepared.sourceFragments);
    let validation = validateTranslatedMdx(sourceMdx, translated);
    if (!validation.ok) {
      const repaired = repairTranslatedStructure(sourceMdx, translated);
      const repairedValidation = validateTranslatedMdx(sourceMdx, repaired);
      if (repairedValidation.ok) return repaired;
      translated = repaired;
      validation = repairedValidation;
    }
    if (!validation.ok) {
      throw new Error(
        `Translation validation failed: ${validation.errors.join("; ")}`,
      );
    }
    return translated;
  };

  let translatedMdx;
  let normalized = normalizeModelOutput(rawOutput);
  try {
    translatedMdx = validateCandidate(normalized);
  } catch (firstError) {
    if (candidateInputPath) throw firstError;
    const repairInstructions = [
      prepared.instructions,
      "上一版输出未通过结构校验。请修复后重新输出完整 MDX。",
      "只允许修复结构：逐字保留所有 SOURCE 占位符、URL、JSX 标签、导入导出、代码围栏和内联代码；不要翻译或改写这些内容。",
      "保留上一版已经完成的中文翻译，只修改导致校验失败的部分。不要解释。",
    ].join("\n");
    const repairInput = [
      prepared.input,
      `<invalid_candidate>\n${normalized}\n</invalid_candidate>`,
      `<validation_error>${firstError.message}</validation_error>`,
    ].join("\n\n");
    try {
      normalized = normalizeModelOutput(
        await requestTranslation({
          instructions: repairInstructions,
          input: repairInput,
          config,
        }),
      );
      translatedMdx = validateCandidate(normalized);
    } catch (repairError) {
      firstError.message += `; repair attempt failed: ${repairError.message}`;
      throw firstError;
    }
  }

  try {
    if (!translatedMdx) throw new Error("Translation produced no output");
  } catch (error) {
    if (candidateOutputPath) {
      await atomicWrite(candidateOutputPath, normalized);
      error.message += `; rejected candidate saved to ${candidateOutputPath}`;
    }
    throw error;
  }

  await atomicWrite(outputPath, translatedMdx);
  process.stdout.write(`Translated ${sourcePath} -> ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`Translation failed: ${error.message}\n`);
  process.exitCode = 1;
});
