import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  requestTranslation,
  translationApiConfigFromEnv,
} from "./translation-api.mjs";

async function withServer(responsePayload, callback) {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = {
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(responsePayload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`, () => received);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("calls an OpenAI-compatible chat completions endpoint", async () => {
  await withServer(
    { choices: [{ message: { content: "# 中文" } }] },
    async (apiUrl, received) => {
      const output = await requestTranslation({
        instructions: "system",
        input: "page",
        config: {
          format: "chat-completions",
          apiUrl,
          apiKey: "test-key",
          model: "test-model",
          timeoutMs: 2_000,
          extraHeaders: {},
        },
      });
      assert.equal(output, "# 中文");
      assert.equal(received().authorization, "Bearer test-key");
      assert.equal(received().body.messages[1].content, "page");
    },
  );
});
test("calls a Responses-compatible endpoint", async () => {
  await withServer({ output_text: "# 中文" }, async (apiUrl, received) => {
    const output = await requestTranslation({
      instructions: "system",
      input: "page",
      config: {
        format: "responses",
        apiUrl,
        apiKey: "test-key",
        model: "test-model",
        timeoutMs: 2_000,
        extraHeaders: {},
      },
    });
    assert.equal(output, "# 中文");
    assert.equal(received().body.instructions, "system");
    assert.equal(received().body.input, "page");
  });
});

test("expands a v1 base URL to the selected request endpoint", () => {
  assert.equal(
    translationApiConfigFromEnv({
      TRANSLATION_API_FORMAT: "chat-completions",
      TRANSLATION_API_URL: "https://example.com/v1/",
    }).apiUrl,
    "https://example.com/v1/chat/completions",
  );
  assert.equal(
    translationApiConfigFromEnv({
      TRANSLATION_API_FORMAT: "responses",
      TRANSLATION_API_URL: "https://example.com/v1",
    }).apiUrl,
    "https://example.com/v1/responses",
  );
});
