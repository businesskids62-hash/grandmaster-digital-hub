// server/services/aiAdapter.js
// Backward-compatible adapter forwarding to centralized lib/aiProviders.js

import {
  executeProviderRotation,
  getProviderStatusList,
  parseProviders,
  AIProviderError,
} from "../../lib/aiProviders.js";

export class AIError extends AIProviderError {}

export function getAIConfig(env = process.env) {
  const providers = parseProviders(env);
  const primary = providers[0] || { provider: "gemini", model: "gemini-3.6-flash" };
  const statuses = getProviderStatusList(env);
  const isConfigured = statuses.some((s) => s.configured);

  return {
    provider: primary.provider,
    model: primary.model,
    baseUrl: "https://generativelanguage.googleapis.com/v1",
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
      : "https://generativelanguage.googleapis.com/v1";

  let url;
  let body;
  if (provider === "gemini") {
    url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey || "")}`;
    body = { contents: [{ role: "user", parts: [{ text: message }] }] };
  } else if (provider === "anthropic") {
    url = `${baseUrl}/v1/messages`;
    body = { model, max_tokens: 1024, messages: [{ role: "user", content: message }] };
  } else {
    // openai / openai-compatible
    url = `${baseUrl}/chat/completions`;
    body = { model, messages: [{ role: "user", content: message }] };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Provider ${provider} returned ${response.status}`);
  }

  const data = await response.json();

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
