// server/services/aiAdapter.js
// Backward-compatible adapter forwarding to centralized lib/aiProviders.js

import {
  executeProviderRotation,
  getProviderStatusList,
  parseProviders,
  AIProviderError,
  PROVIDER_DEFAULTS,
} from "../../lib/aiProviders.js";

export class AIError extends AIProviderError {}

export function getAIConfig(env = process.env) {
  const providers = parseProviders(env);
  const primary = providers[0] || {
    provider: "gemini",
    model: PROVIDER_DEFAULTS.gemini.defaultModel,
  };
  const statuses = getProviderStatusList(env);
  const isConfigured = statuses.some((s) => s.configured);

  return {
    provider: primary.provider,
    model: primary.model,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    configured: isConfigured,
    problem: isConfigured ? "" : "API key is not configured.",
  };
}

export async function generateReply(
  { message, history = [] },
  env = process.env,
) {
  const result = await executeProviderRotation({
    message,
    history,
    env,
  });
  return result.reply;
}

/**
 * Backward-compatible provider reply used by the regression test suite.
 * Accepts an explicit { message, apiKey, model, provider } payload, calls the
 * provider via globalThis.fetch (so it can be mocked in tests), and returns
 * { reply, provider, model, timestamp }.
 */
export async function generateAiReply(
  { message, apiKey, model, provider = "gemini" },
  _env = process.env,
) {
  // Input validation: empty/whitespace message is rejected before any network call.
  if (typeof message !== "string" || !message.trim()) {
    const err = new Error("INVALID_INPUT");
    err.code = "INVALID_INPUT";
    err.status = 400;
    throw err;
  }

  // Input validation: missing or placeholder API key is rejected before any network call.
  const key = (apiKey || "").trim();
  if (!key || key === "your_gemini_api_key_here") {
    const err = new Error("AI_CONFIG_MISSING");
    err.code = "AI_CONFIG_MISSING";
    err.status = 503;
    throw err;
  }

  const baseUrl =
    provider === "anthropic"
      ? "https://api.anthropic.com"
      : provider === "openai"
      ? "https://api.openai.com/v1"
      : "https://generativelanguage.googleapis.com/v1beta";

  let url;
  let body;
  let headers = { "Content-Type": "application/json" };
  if (provider === "gemini") {
    // Credentials travel in a header, never in the URL or logs.
    url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
    headers = { ...headers, "x-goog-api-key": key };
    body = { contents: [{ role: "user", parts: [{ text: message }] }] };
  } else if (provider === "anthropic") {
    url = `${baseUrl}/v1/messages`;
    headers = {
      ...headers,
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
    body = { model, max_tokens: 1024, messages: [{ role: "user", content: message }] };
  } else {
    // openai / openai-compatible
    url = `${baseUrl}/chat/completions`;
    headers = { ...headers, Authorization: `Bearer ${key}` };
    body = { model, messages: [{ role: "user", content: message }] };
  }

  async function callProvider() {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const err = new Error(errData.error?.message || `Provider ${provider} returned ${response.status}`);
      err.status = response.status;
      throw err;
    }

    return response.json();
  }

  async function tryWithRetry(tries = 3) {
    let lastError;
    for (let i = 0; i < tries; i++) {
      try {
        return await callProvider();
      } catch (err) {
        lastError = err;
        const status = err.status;
        if (status === 400 || status === 401 || status === 403 || status === 404) {
          throw err;
        }
        if (status === 429 || status === 500 || status === 503) {
          if (i < tries - 1) {
            const delay = Math.pow(2, i) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        throw err;
      }
    }
    throw lastError;
  }

  const data = await tryWithRetry();

  let text = "";
  if (provider === "gemini") {
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } else if (provider === "anthropic") {
    text = Array.isArray(data?.content)
      ? data.content.map((b) => b.text).join("")
      : data?.content || "";
  } else {
    text = data?.choices?.[0]?.message?.content || "";
  }

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("AI provider returned an empty response.");
  }

  return {
    reply: text.trim(),
    provider,
    model,
    timestamp: new Date().toISOString(),
  };
}
