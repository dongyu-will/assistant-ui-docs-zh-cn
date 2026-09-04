import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function run(command, arguments_, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("CLI translates, validates, and atomically writes one page", async () => {
  const directory = await mkdtemp(join(tmpdir(), "assistant-ui-translation-"));
  const sourcePath = join(directory, "source.mdx");
  const outputPath = join(directory, "translated.mdx");
  const source = `---
title: Hello
description: Hello page.
---

# Hello

Use \`ThreadPrimitive.Root\`.

\`\`\`ts
const value = "unchanged";
\`\`\`
`;
  await writeFile(sourcePath, source, "utf8");

  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const input = body.messages[1].content;
    const masked = input.match(/<english_mdx>\n([\s\S]*?)\n<\/english_mdx>/)[1];
    const translated = masked
      .replace("title: Hello", "title: 你好")
      .replace("description: Hello page.", "description: 你好页面。")
      .replace("# Hello", "# 你好")
      .replace("Use ", "使用");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ choices: [{ message: { content: translated } }] }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const result = await run(
      process.execPath,
      [
        "scripts/translation/translate-page.mjs",
        "--source",
        sourcePath,
        "--output",
        outputPath,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRANSLATION_API_FORMAT: "chat-completions",
          TRANSLATION_API_URL: `http://127.0.0.1:${address.port}`,
          TRANSLATION_API_KEY: "test-key",
          TRANSLATION_MODEL: "test-model",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /test-key/);
    const translated = await readFile(outputPath, "utf8");
    assert.match(translated, /# 你好/);
    assert.match(translated, /`ThreadPrimitive\.Root`/);
    assert.match(translated, /const value = "unchanged";/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
