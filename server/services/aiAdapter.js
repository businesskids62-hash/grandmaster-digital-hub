// AI provider adapter. API keys stay on the server and are never sent to the browser.
//
// Supported providers (set AI_PROVIDER in server/.env):
//   gemini    - Google Gemini API (default, model: gemini-3.8-flash)
//   anthropic - Anthropic Messages API
//   openai    - any OpenAI-compatible Chat Completions API (OpenAI, OpenRouter, Groq, local servers...)
//
// Optional in server/.env:
//   AI_FALLBACK_MODEL - model to try if the main model is overloaded (503/429/5xx)

const SYSTEM_PROMPT =
  "You are Grandmaster AI, a helpful assistant for coding, business planning, learning and project management. " +
  "The user may write in English, Urdu or Roman Urdu; reply in the language they use. " +
  "Be practical and honest. Never claim to have run code, created files, deployed anything or executed trades " +
  "unless a tool result explicitly confirms it.";

const DEFAULTS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.8-flash",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
};

export class AIError extends Error {
  constructor(message, status = 502, retryable = false) {
    super(message);
    this.name = "AIError";
    this.status = status;
    this.retryable = retryable;
  }
}

export function getAIConfig(env = process.env) {
  const provider = (env.AI_PROVIDER || "gemini").toLowerCase();

  if (!DEFAULTS[provider]) {
    return {
      provider,
      configured: false,
      problem: `Unsupported AI_PROVIDER "${provider}". Use "gemini", "anthropic" or "openai".`,
    };
  }

  const apiKey = (env.AI_API_KEY || "").trim();
  const baseUrl = (env.AI_BASE_URL || DEFAULTS[provider].baseUrl).replace(
    /\/$/,
    "",
  );
  const model = (env.AI_MODEL || DEFAULTS[provider].model).trim();
  const timeoutMs =
    Number(env.AI_TIMEOUT_MS) > 0 ? Number(env.AI_TIMEOUT_MS) : 60000;
  const maxTokens =
    Number(env.AI_MAX_TOKENS) > 0 ? Number(env.AI_MAX_TOKENS) : 2048;

  return {
    provider,
    baseUrl,
    model,
    apiKey,
    timeoutMs,
    maxTokens,
    configured: Boolean(apiKey),
    problem: apiKey ? "" : "AI_API_KEY is not set in server/.env.",
  };
}

function toMessages(history, message) {
  const cleaned = history
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string",
    )
    .map((item) => ({ role: item.role, content: item.content }));

  // Providers require the conversation to start with a user turn.
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();

  // Merge consecutive same-role turns (Anthropic rejects them).
  const merged = [];
  for (const item of [...cleaned, { role: "user", content: message }]) {
    const last = merged[merged.length - 1];
    if (last && last.role === item.role) {
      last.content += `\n\n${item.content}`;
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

async function postJson(url, { headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const detail =
        data?.error?.message || data?.message || `HTTP ${response.status}`;
      // Temporary provider problems are worth retrying.
      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      const status =
        response.status === 429 ? 429 : response.status === 503 ? 503 : 502;
      throw new AIError(`AI provider error: ${detail}`, status, retryable);
    }

    return data;
  } catch (error) {
    if (error instanceof AIError) throw error;
    // Timeouts are not retried (3 x 60s would be too long to wait).
    if (error.name === "AbortError")
      throw new AIError("AI provider request timed out.", 504);
    throw new AIError(
      `Could not reach the AI provider: ${error.message}`,
      502,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(config, messages) {
  const data = await postJson(
    `${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent`,
    {
      timeoutMs: config.timeoutMs,
      headers: { "x-goog-api-key": config.apiKey },
      body: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: messages.map((item) => ({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: item.content }],
        })),
        generationConfig: { maxOutputTokens: config.maxTokens },
      },
    },
  );

  const parts = data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    const reason =
      data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
    throw new AIError(
      reason
        ? `Gemini returned no answer (${reason}).`
        : "AI provider returned an empty response.",
      502,
    );
  }

  // Skip "thought" parts; keep only the visible answer text.
  return parts
    .filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("");
}

async function callAnthropic(config, messages) {
  const data = await postJson(`${config.baseUrl}/v1/messages`, {
    timeoutMs: config.timeoutMs,
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: config.model,
      max_tokens: config.maxTokens,
      system: SYSTEM_PROMPT,
      messages,
    },
  });

  const text = Array.isArray(data?.content)
    ? data.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
    : "";

  return text;
}

async function callOpenAI(config, messages) {
  const data = await postJson(`${config.baseUrl}/chat/completions`, {
    timeoutMs: config.timeoutMs,
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: {
      model: config.model,
      max_tokens: config.maxTokens,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    },
  });

  return data?.choices?.[0]?.message?.content || "";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries temporary errors with exponential backoff (~1s, 2s, 4s).
async function callWithRetry(caller, config, messages, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await caller(config, messages);
    } catch (error) {
      const canRetry =
        error instanceof AIError && error.retryable && attempt < retries;
      if (!canRetry) throw error;
      await sleep(1000 * 2 ** attempt + Math.random() * 300);
    }
  }
}

export async function generateReply(
  { message, history = [] },
  env = process.env,
) {
  const config = getAIConfig(env);

  if (!config.configured) {
    throw new AIError(config.problem || "AI provider is not configured.", 503);
  }

  const messages = toMessages(history, message);
  const callers = {
    gemini: callGemini,
    anthropic: callAnthropic,
    openai: callOpenAI,
  };
  const caller = callers[config.provider];
  const fallbackModel = (env.AI_FALLBACK_MODEL || "").trim();
  let reply;

  try {
    reply = await callWithRetry(caller, config, messages);
  } catch (error) {
    const canFallback =
      error instanceof AIError &&
      error.retryable &&
      fallbackModel &&
      fallbackModel !== config.model;

    if (!canFallback) throw error;

    console.warn(`[ai] ${config.model} busy, falling back to ${fallbackModel}`);
    reply = await callWithRetry(
      caller,
      { ...config, model: fallbackModel },
      messages,
      1,
    );
  }

  if (typeof reply !== "string" || !reply.trim()) {
    throw new AIError("AI provider returned an empty response.", 502);
  }

  return reply.trim();
}
