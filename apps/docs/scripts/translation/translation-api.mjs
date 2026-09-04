function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeApiUrl(value, format) {
  const trimmed = value.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/${format === "responses" ? "responses" : "chat/completions"}`;
  }
  return trimmed;
}

export function translationApiConfigFromEnv(environment = process.env) {
  const format = environment.TRANSLATION_API_FORMAT || "chat-completions";
  const defaultUrl =
    format === "responses"
      ? "https://api.openai.com/v1/responses"
      : "https://api.openai.com/v1/chat/completions";

  return {
    format,
    apiUrl: normalizeApiUrl(
      environment.TRANSLATION_API_URL || defaultUrl,
      format,
    ),
    apiKey: environment.TRANSLATION_API_KEY,
    model: environment.TRANSLATION_MODEL,
    timeoutMs: Number(environment.TRANSLATION_API_TIMEOUT_MS || 120_000),
    temperature:
      environment.TRANSLATION_API_TEMPERATURE === undefined
        ? undefined
        : Number(environment.TRANSLATION_API_TEMPERATURE),
    extraHeaders: environment.TRANSLATION_API_HEADERS_JSON
      ? JSON.parse(environment.TRANSLATION_API_HEADERS_JSON)
      : {},
  };
}

function responseText(payload, format) {
  if (format === "responses") {
    if (typeof payload.output_text === "string") return payload.output_text;
    const pieces = payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter(
        (item) => item.type === "output_text" && typeof item.text === "string",
      )
      .map((item) => item.text);
    if (pieces?.length) return pieces.join("");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((item) => typeof item?.text === "string")
      .map((item) => item.text)
      .join("");
  }
  throw new Error(
    `Translation response did not contain text for ${format} format`,
  );
}

function requestBody({ instructions, input, config }) {
  if (config.format === "responses") {
    return {
      model: config.model,
      instructions,
      input,
      ...(config.temperature === undefined
        ? {}
        : { temperature: config.temperature }),
    };
  }
  if (config.format === "chat-completions") {
    return {
      model: config.model,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
      ...(config.temperature === undefined
        ? {}
        : { temperature: config.temperature }),
    };
  }
  throw new Error(`Unsupported TRANSLATION_API_FORMAT: ${config.format}`);
}

function retryable(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function requestTranslation({
  instructions,
  input,
  config,
  fetchImpl = fetch,
}) {
  required(config.apiKey, "TRANSLATION_API_KEY");
  required(config.model, "TRANSLATION_MODEL");
  required(config.apiUrl, "TRANSLATION_API_URL");

  const body = requestBody({ instructions, input, config });
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(config.apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          ...config.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 2_000);
        const error = new Error(
          `Translation API returned HTTP ${response.status}: ${detail}`,
        );
        if (!retryable(response.status) || attempt === 3) throw error;
        lastError = error;
      } else {
        return responseText(await response.json(), config.format);
      }
    } catch (error) {
      if (attempt === 3 || (error.name !== "AbortError" && !lastError))
        throw error;
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }

  throw lastError ?? new Error("Translation API request failed");
}
