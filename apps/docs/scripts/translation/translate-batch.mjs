#!/usr/bin/env node

import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, relative, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

const execFileAsync = promisify(execFile);
const appRoot = resolve(process.cwd());
const repoRoot = resolve(appRoot, "../..");
const pageScript = resolve(appRoot, "scripts/translation/translate-page.mjs");
const sectionedPageScript = resolve(
  appRoot,
  "scripts/translation/translate-sectioned-page.mjs",
);
const defaultCollections = [
  "docs",
  "elements",
  "design",
  "examples",
  "tap-docs",
];

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function git(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function sourcePage(upstreamRef, repoPath) {
  return git(["show", `${upstreamRef}:${repoPath}`]);
}

function hasChinese(text) {
  return /\p{Script=Han}/u.test(text);
}

function outputPath(repoPath) {
  return resolve(repoRoot, repoPath);
}

async function listPages(upstreamRef, collections) {
  const roots = collections.map(
    (collection) => `apps/docs/content/${collection}`,
  );
  const names = await git([
    "ls-tree",
    "-r",
    "--name-only",
    upstreamRef,
    "--",
    ...roots,
  ]);
  return names
    .trim()
    .split("\n")
    .filter((name) => name.endsWith(".mdx"))
    .sort();
}

async function readStatus(path) {
  if (!(await fileExists(path))) return new Map();
  const entries = new Map();
  const text = await readFile(path, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const item = JSON.parse(line);
    entries.set(item.path, item);
  }
  return entries;
}

async function recordStatus(path, item) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(
    path,
    `${JSON.stringify({ ...item, at: new Date().toISOString() })}\n`,
    "utf8",
  );
}

async function translate(
  repoPath,
  upstreamRef,
  glossaryPath,
  sectioned,
  maxSectionBytes,
) {
  const source = await sourcePage(upstreamRef, repoPath);
  const destination = outputPath(repoPath);
  const current = (await fileExists(destination))
    ? await readFile(destination, "utf8")
    : "";

  if (current && current !== source && hasChinese(current)) {
    return { status: "skipped-existing", bytes: Buffer.byteLength(source) };
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "assistant-ui-batch-"),
  );
  const sourcePath = join(temporaryDirectory, "source.mdx");
  await writeFile(sourcePath, source, "utf8");
  try {
    const args = [
      sectioned ? sectionedPageScript : pageScript,
      "--source",
      sourcePath,
      "--output",
      destination,
      ...(!sectioned && current && current !== source && hasChinese(current)
        ? ["--current", destination]
        : []),
      ...(sectioned && maxSectionBytes
        ? ["--max-section-bytes", maxSectionBytes]
        : []),
      "--glossary",
      resolve(appRoot, glossaryPath),
    ];
    await execFileAsync(process.execPath, args, {
      cwd: appRoot,
      env: process.env,
      maxBuffer: 2 * 1024 * 1024,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  return { status: "translated", bytes: Buffer.byteLength(source) };
}

async function main() {
  const commandArguments = process.argv.slice(2);
  if (commandArguments[0] === "--") commandArguments.shift();
  const { values } = parseArgs({
    args: commandArguments,
    options: {
      collections: { type: "string", default: defaultCollections.join(",") },
      "upstream-ref": { type: "string", default: "upstream/main" },
      limit: { type: "string" },
      concurrency: { type: "string", default: "4" },
      "start-at": { type: "string" },
      status: { type: "string", default: "translation/.batch-status.jsonl" },
      glossary: { type: "string", default: "translation/glossary.md" },
      resume: { type: "boolean", default: true },
      "dry-run": { type: "boolean", default: false },
      sectioned: { type: "boolean", default: false },
      "max-section-bytes": { type: "string" },
    },
    strict: true,
  });

  const collections = values.collections
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const upstreamRef = values["upstream-ref"];
  const statusPath = resolve(appRoot, values.status);
  const glossaryPath = resolve(appRoot, values.glossary);
  const status = await readStatus(statusPath);
  const pages = await listPages(upstreamRef, collections);
  const startIndex = values["start-at"]
    ? Math.max(0, pages.indexOf(values["start-at"]))
    : 0;
  const limit = values.limit === undefined ? Infinity : Number(values.limit);
  const concurrency = Number(values.concurrency);
  if (Number.isNaN(limit) || limit < 1)
    throw new Error("--limit must be a positive number");
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("--concurrency must be a positive integer");

  let attempted = 0;
  let translated = 0;
  let skipped = 0;
  let failed = 0;
  const queue = pages
    .slice(startIndex)
    .filter(
      (repoPath) =>
        !(values.resume && status.get(repoPath)?.status === "translated"),
    );
  const selected = queue.slice(0, limit);
  async function worker() {
    while (selected.length > 0) {
      const repoPath = selected.shift();
      if (!repoPath) return;
      const previous = status.get(repoPath);

      attempted += 1;
      const source = await sourcePage(upstreamRef, repoPath);
      const destination = outputPath(repoPath);
      const current = (await fileExists(destination))
        ? await readFile(destination, "utf8")
        : "";
      if (current && current !== source && hasChinese(current)) {
        skipped += 1;
        await recordStatus(statusPath, {
          path: repoPath,
          upstreamRef,
          status: "skipped-existing",
        });
        process.stdout.write(`[skip] ${repoPath}\n`);
        continue;
      }

      if (values["dry-run"]) {
        process.stdout.write(
          `[dry-run] ${repoPath} (${Buffer.byteLength(source)} bytes)\n`,
        );
        continue;
      }

      try {
        const result = await translate(
          repoPath,
          upstreamRef,
          values.glossary,
          values.sectioned,
          values["max-section-bytes"],
        );
        translated += 1;
        await recordStatus(statusPath, {
          path: repoPath,
          upstreamRef,
          ...result,
        });
        process.stdout.write(`[ok] ${repoPath}\n`);
      } catch (error) {
        failed += 1;
        await recordStatus(statusPath, {
          path: repoPath,
          upstreamRef,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        process.stderr.write(
          `[failed] ${repoPath}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  }

  skipped += pages.length - startIndex - queue.length;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, selected.length || 1) }, () =>
      worker(),
    ),
  );

  process.stdout.write(
    JSON.stringify(
      {
        upstreamRef,
        collections,
        totalPages: pages.length,
        attempted,
        concurrency,
        translated,
        skipped,
        failed,
        statusPath,
      },
      null,
      2,
    ) + "\n",
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`Batch translation failed: ${error.message}\n`);
  process.exitCode = 1;
});
