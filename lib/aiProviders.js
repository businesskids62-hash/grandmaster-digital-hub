// lib/aiProviders.js
// Multi-provider rotation engine with circuit breakers, retry budgets, and status reporting.

import dns from "node:dns";
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {}

const TOTAL_BUDGET_MS = 28_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_PROVIDER_RETRIES = 1;

export const PROVIDER_DEFAULTS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.6-flash",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
};

const SYSTEM_PROMPT =
  "You are Grandmaster AI, an expert assistant for coding, business planning, learning and project management. " +
  "The user may write in English, Urdu or Roman Urdu; reply in the language they use. " +
  "Be concise, practical, and honest. Never claim to have run code or executed trades unless confirmed.";

// In-memory circuit breaker state per provider ID (e.g., 'gemini:gemini-2.5-flash')
const circuitBreakers = new Map();

export function resetBreakerState() {
  circuitBreakers.clear();
}

export function parseProviders(env = process.env) {
  const rawList = env.AI_PROVIDERS;
  const list = [];

  if (rawList && typeof rawList === "string" && rawList.trim()) {
    const items = rawList.split(",").map((s) => s.trim()).filter(Boolean);
    for (const item of items) {
      const parts = item.split(":");
      const providerType = (parts[0] || "gemini").trim().toLowerCase();
      const model = parts.slice(1).join(":").trim() || PROVIDER_DEFAULTS[providerType]?.defaultModel || "gemini-3.6-flash";
      list.push({
        id: `${providerType}:${model}`,
        provider: providerType,
        model,
      });
    }
  }

  // Fallback to legacy single provider / fallback model if AI_PROVIDERS is empty
  if (list.length === 0) {
    const primaryType = (env.AI_PROVIDER || "gemini").toLowerCase();
    const primaryModel = env.GEMINI_MODEL || env.AI_MODEL || PROVIDER_DEFAULTS[primaryType]?.defaultModel || "gemini-3.6-flash";
    list.push({
      id: `${primaryType}:${primaryModel}`,
      provider: primaryType,
      model: primaryModel,
    });

    const fallbackModel = (env.GEMINI_FALLBACK_MODEL || env.AI_FALLBACK_MODEL || "").trim();
    if (fallbackModel && fallbackModel !== primaryModel) {
      list.push({
        id: `${primaryType}:${fallbackModel}`,
        provider: primaryType,
        model: fallbackModel,
      });
    }
  }

  return list;
}

function getProviderKey(providerType, env = process.env) {
  if (providerType === "gemini") {
    return (env.GEMINI_API_KEY || env.AI_API_KEY || "").trim();
  }
  if (providerType === "anthropic") {
    return (env.ANTHROPIC_API_KEY || env.AI_API_KEY || "").trim();
  }
  if (providerType === "openai") {
    return (env.OPENAI_API_KEY || env.AI_API_KEY || "").trim();
  }
  return (env.AI_API_KEY || "").trim();
}

function getBreaker(providerId) {
  let breaker = circuitBreakers.get(providerId);
  if (!breaker) {
    breaker = {
      state: "available", // 'available' | 'cooling' | 'failed'
      coolingUntil: null,
      cooldownSeconds: 60,
      lastLatencyMs: null,
      lastSuccessTime: null,
      lastFailureReason: null,
      consecutiveFailures: 0,
    };
    circuitBreakers.set(providerId, breaker);
  }

  // Check if cooling period elapsed -> transition to available (probe mode)
  if (breaker.state === "cooling" && breaker.coolingUntil) {
    const diff = new Date(breaker.coolingUntil).getTime() - Date.now();
    if (diff <= 0) {
      breaker.state = "available";
      breaker.coolingUntil = null;
    }
  }

  return breaker;
}

export function getProviderStatusList(env = process.env) {
  const providers = parseProviders(env);
  return providers.map((p) => {
    const breaker = getBreaker(p.id);
    const key = getProviderKey(p.provider, env);
    const isConfigured = Boolean(key);

    let state = breaker.state;
    let reason = breaker.lastFailureReason;

    if (!isConfigured) {
      state = "failed";
      reason = `API key missing for ${p.provider}`;
    }

    return {
      id: p.id,
      provider: p.provider,
      model: p.model,
      configured: isConfigured,
      state,
      coolingUntil: breaker.coolingUntil,
      lastLatencyMs: breaker.lastLatencyMs,
      lastSuccessTime: breaker.lastSuccessTime,
      lastFailureReason: reason,
    };
  });
}

function parseRetryAfter(response) {
  if (!response || !response.headers) return DEFAULT_COOLDOWN_MS;
  const header = response.headers.get
    ? response.headers.get("retry-after")
    : response.headers["retry-after"];
  if (!header) return DEFAULT_COOLDOWN_MS;

  const seconds = Number.parseInt(header, 10);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const diff = date - Date.now();
    if (diff > 0) return diff;
  }

  return DEFAULT_COOLDOWN_MS;
}

export class AIProviderError extends Error {
  constructor(message, status = 502, retryable = false, retryAfterMs = DEFAULT_COOLDOWN_MS) {
    super(message);
    this.name = "AIProviderError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

async function executeSingleCall({ providerInfo, messages, apiKey, timeoutMs, fetchImpl }) {
  const { provider, model } = providerInfo;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let url = "";
    let headers = { "Content-Type": "application/json" };
    let body = {};

    if (provider === "gemini") {
      url = `${PROVIDER_DEFAULTS.gemini.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      headers["x-goog-api-key"] = apiKey;
      body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 2048 },
      };
    } else if (provider === "anthropic") {
      url = `${PROVIDER_DEFAULTS.anthropic.baseUrl}/v1/messages`;
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      body = {
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages,
      };
    } else if (provider === "openai") {
      url = `${PROVIDER_DEFAULTS.openai.baseUrl}/chat/completions`;
      headers["Authorization"] = `Bearer ${apiKey}`;
      body = {
        model,
        max_tokens: 2048,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      };
    } else {
      throw new AIProviderError(`Unsupported provider: ${provider}`, 400, false);
    }

    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const status = res.status;
    const retryAfterMs = parseRetryAfter(res);

    if (!res.ok) {
      let errorMsg = `HTTP ${status}`;
      try {
        const errorData = await res.json();
        errorMsg = errorData?.error?.message || errorData?.message || errorMsg;
      } catch {
        // use default HTTP status
      }

      // 400, 401, 403, 404 should NEVER be retried
      if ([400, 401, 403, 404].includes(status)) {
        throw new AIProviderError(`[${provider}:${model}] ${errorMsg}`, status, false);
      }

      // 429, 503, 500, 502, 504 are retryable/breaker cooling
      const retryable = [429, 500, 502, 503, 504].includes(status);
      throw new AIProviderError(`[${provider}:${model}] ${errorMsg}`, status, retryable, retryAfterMs);
    }

    const data = await res.json();
    let reply = "";

    if (provider === "gemini") {
      const parts = data?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        reply = parts
          .filter((p) => typeof p.text === "string" && !p.thought)
          .map((p) => p.text)
          .join("");
      }
    } else if (provider === "anthropic") {
      if (Array.isArray(data?.content)) {
        reply = data.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
      }
    } else if (provider === "openai") {
      reply = data?.choices?.[0]?.message?.content || "";
    }

    if (!reply.trim()) {
      throw new AIProviderError(`[${provider}:${model}] Provider returned empty text`, 502, true);
    }

    return reply.trim();
  } catch (err) {
    if (err instanceof AIProviderError) throw err;

    if (err.name === "AbortError") {
      throw new AIProviderError(`[${provider}:${model}] Request timed out after ${timeoutMs}ms`, 504, true, DEFAULT_COOLDOWN_MS);
    }

    throw new AIProviderError(`[${provider}:${model}] Connection failed: ${err.message}`, 502, true, DEFAULT_COOLDOWN_MS);
  } finally {
    clearTimeout(timer);
  }
}

function prepareMessages(history = [], message = "") {
  const safeHistory = (history || [])
    .filter((item) => item && typeof item.content === "string")
    .map((item) => ({
      role: item.role === "user" ? "user" : "assistant",
      content: item.content,
    }));

  const messages = [...safeHistory, { role: "user", content: message }];
  while (messages.length && messages[0].role !== "user") {
    messages.shift();
  }
  return messages;
}

export async function executeProviderRotation({
  message,
  history = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const providers = parseProviders(env);
  const attempts = [];
  const startBudget = Date.now();
  const messages = prepareMessages(history, message);

  for (const p of providers) {
    const elapsedTotal = Date.now() - startBudget;
    const remainingBudget = TOTAL_BUDGET_MS - elapsedTotal;

    // Budget check: if less than 1.5s remaining, break out cleanly
    if (remainingBudget < 1500) {
      attempts.push({
        provider: p.id,
        status: "budget_exceeded",
        reason: "Overall 28s request budget exhausted.",
      });
      break;
    }

    const breaker = getBreaker(p.id);

    // Skip if cooling down
    if (breaker.state === "cooling" && breaker.coolingUntil) {
      if (Date.now() < new Date(breaker.coolingUntil).getTime()) {
        attempts.push({
          provider: p.id,
          status: "cooling_skipped",
          coolingUntil: breaker.coolingUntil,
          reason: `Cooling down until ${breaker.coolingUntil}`,
        });
        continue;
      } else {
        // Probe transition
        breaker.state = "available";
        breaker.coolingUntil = null;
      }
    }

    const apiKey = getProviderKey(p.provider, env);
    if (!apiKey) {
      breaker.state = "failed";
      breaker.lastFailureReason = `Missing API key for ${p.provider}`;
      attempts.push({
        provider: p.id,
        status: "failed",
        error: "Missing API key",
      });
      continue;
    }

    // Try up to 1 retry (max 2 attempts per provider)
    let providerSuccess = false;
    let reply = "";
    const providerTimeout = Math.min(remainingBudget, 12_000);

    for (let tryIndex = 0; tryIndex <= MAX_PROVIDER_RETRIES; tryIndex++) {
      const callStart = Date.now();
      try {
        reply = await executeSingleCall({
          providerInfo: p,
          messages,
          apiKey,
          timeoutMs: providerTimeout,
          fetchImpl,
        });

        const latency = Date.now() - callStart;
        breaker.state = "available";
        breaker.coolingUntil = null;
        breaker.lastLatencyMs = latency;
        breaker.lastSuccessTime = new Date().toISOString();
        breaker.lastFailureReason = null;
        breaker.consecutiveFailures = 0;

        attempts.push({
          provider: p.id,
          status: "success",
          latencyMs: latency,
        });

        providerSuccess = true;
        return {
          reply,
          provider: p.provider,
          model: p.model,
          attempts,
        };
      } catch (err) {
        const latency = Date.now() - callStart;
        breaker.lastLatencyMs = latency;
        breaker.lastFailureReason = err.message;

        const isUnrecoverable = [400, 401, 403, 404].includes(err.status);

        if (isUnrecoverable) {
          breaker.state = "failed";
          attempts.push({
            provider: p.id,
            status: "failed",
            error: err.message,
            statusCode: err.status,
          });
          // Do not retry 400/401/403/404
          break;
        }

        // 429 / 503 / timeout / network failure
        const cooldownMs = err.retryAfterMs || DEFAULT_COOLDOWN_MS;
        breaker.state = "cooling";
        breaker.coolingUntil = new Date(Date.now() + cooldownMs).toISOString();

        if (tryIndex < MAX_PROVIDER_RETRIES) {
          // Jittered backoff (150ms - 400ms)
          const jitter = 150 + Math.random() * 250;
          await new Promise((r) => setTimeout(r, jitter));
        } else {
          attempts.push({
            provider: p.id,
            status: "failed",
            error: err.message,
            statusCode: err.status,
            coolingUntil: breaker.coolingUntil,
          });
        }
      }
    }
  }

  // If we reach here, all providers failed
  const error = new Error("All AI providers failed or budget was exceeded.");
  error.status = 503;
  error.attempts = attempts;
  throw error;
}
