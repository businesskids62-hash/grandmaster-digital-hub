// lib/aiProviders.js
// Multi-provider rotation engine with circuit breakers, retry budgets, and status reporting.

import dns from "node:dns";
// Fix for slow/timeouting fetch on Windows: prefer IPv4 instead of waiting on broken IPv6.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {}

const TOTAL_BUDGET_MS = 28_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_PROVIDER_RETRIES = 1;

export const PROVIDER_DEFAULTS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
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

export const AI_PROVIDERS = ["gemini", "cline-free/nemotron-3.5"];

export const PROVIDER_PRIORITY = (() => {
  if (
    typeof process !== "undefined" &&
    process.env &&
    process.env.AI_PROVIDER
  ) {
    return process.env.AI_PROVIDER
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return AI_PROVIDERS;
})();

export const INITIAL_WELCOME_MESSAGE = {
  id: "welcome-001",
  role: "assistant",
  content: "Welcome to Grandmaster Digital Hub! How can I assist you today?",
  timestamp: new Date().toISOString(),
};

const SYSTEM_PROMPT =
  "You are Grandmaster AI, an expert assistant for coding, business planning, learning and project management. " +
  "The user may write in English, Urdu or Roman Urdu; reply in the language they use. " +
  "Be concise, practical, and honest. Never claim to have run code or executed trades unless confirmed.";

const circuitBreakers = new Map();

export function resetBreakerState() {
  circuitBreakers.clear();
}

export function parseProviders(env = process.env) {
  const rawList =
    (env && env.AI_PROVIDERS) ||
    (typeof process !== "undefined" && process.env && process.env.AI_PROVIDERS)
      ? process.env.AI_PROVIDERS
      : PROVIDER_PRIORITY.join(",");
  const list = [];
  if (rawList && typeof rawList === "string" && rawList.trim()) {
    const items = rawList.split(",").map((s) => s.trim()).filter(Boolean);
    for (const item of items) {
      const parts = item.split(":");
      const providerType = (parts[0] || "gemini").trim().toLowerCase();
      const model =
        parts.slice(1).join(":").trim() ||
        PROVIDER_DEFAULTS[providerType]?.defaultModel ||
        "gemini-2.5-flash";
      list.push({
        id: `${providerType}:${model}`,
        provider: providerType,
        model,
      });
    }
  }

  if (list.length === 0) {
    const primaryType = (env && env.AI_PROVIDER) || "gemini";
    const primaryModel =
      (env && env.GEMINI_MODEL) ||
      PROVIDER_DEFAULTS[primaryType]?.defaultModel ||
      "gemini-2.5-flash";
    list.push({
      id: `${primaryType}:${primaryModel}`,
      provider: primaryType,
      model: primaryModel,
    });

    const fallbackModel = (env && env.GEMINI_FALLBACK_MODEL) || "";
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
  if (providerType === "gemini") return (env && env.GEMINI_API_KEY) || "";
  if (providerType === "anthropic") return (env && env.ANTHROPIC_API_KEY) || "";
  if (providerType === "openai") return (env && env.OPENAI_API_KEY) || "";
  return (env && env.AI_API_KEY) || "";
}

function getBreaker(providerId) {
  let breaker = circuitBreakers.get(providerId);
  if (!breaker) {
    breaker = {
      state: "available",
      coolingUntil: null,
      cooldownSeconds: 60,
      lastLatencyMs: null,
      lastSuccessTime: null,
      lastFailureReason: null,
      consecutiveFailures: 0,
    };
    circuitBreakers.set(providerId, breaker);
  }
  return breaker;
}

export function getProviderStatusList(env = process.env) {
  return parseProviders(env).map((p) => {
    const b = getBreaker(p.id);
    return {
      id: p.id,
      provider: p.provider,
      model: p.model,
      state: b.state,
      coolingUntil: b.coolingUntil,
      configured: Boolean(getProviderKey(p.provider, env)),
    };
  });
}

export class AIProviderError extends Error {
  constructor(message, status = 502, retryable = false) {
    super(message);
    this.name = "AIProviderError";
    this.status = status;
    this.retryable = retryable;
  }
}

async function executeSingleCall({ providerInfo, messages, apiKey, timeoutMs, fetchImpl }) {
  const baseUrl = PROVIDER_DEFAULTS[providerInfo.provider]?.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const url = `${baseUrl}/models/${encodeURIComponent(providerInfo.model)}:generateContent?key=${encodeURIComponent(apiKey || "")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: messages[messages.length - 1]?.content || "" }] }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      err.retryable = response.status === 429 || response.status === 503;
      throw err;
    }
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function getAvailableProvider(env = process.env) {
  const providers = parseProviders(env);
  const statuses = getProviderStatusList(env);
  const available = statuses.filter((s) => s.state === "available" && s.configured);
  if (available.length) return available[0].id;
  const first = providers[0];
  return first ? first.id : "cline-free/nemotron-3.5";
}

export async function generateAiReply(messages, provider) {
  const providerId = provider || "cline-free/nemotron-3.5";
  const env = process.env;
  const providers = parseProviders(env);
  const selected =
    providers.find((p) => p.id === providerId || p.provider === providerId) || providers[0];
  if (!selected) throw new AIProviderError("No provider available", 503);
  const apiKey = getProviderKey(selected.provider, env);
  if (!apiKey) throw new AIProviderError("API key not configured", 503);
  const text = await executeSingleCall({
    providerInfo: selected,
    messages: Array.isArray(messages)
      ? messages
      : [{ role: "user", content: String(messages) }],
    apiKey,
    timeoutMs: 10_000,
    fetchImpl: globalThis.fetch,
  });
  return {
    reply: text,
    provider: selected.provider,
    model: selected.model,
    timestamp: new Date().toISOString(),
  };
}

export async function executeProviderRotation({
  message,
  history = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const providers = parseProviders(env);
  const attempts = [];
  let lastError = null;

  for (const p of providers) {
    const breaker = getBreaker(p.id);
    if (breaker.state === "cooling" && breaker.coolingUntil) {
      if (Date.now() < new Date(breaker.coolingUntil).getTime()) {
        attempts.push({
          provider: p.id,
          status: "cooling_skipped",
          coolingUntil: breaker.coolingUntil,
        });
        continue;
      } else {
        breaker.state = "available";
        breaker.coolingUntil = null;
      }
    }

    const apiKey = getProviderKey(p.provider, env);
    if (!apiKey) {
      breaker.state = "failed";
      breaker.lastFailureReason = `Missing API key for ${p.provider}`;
      attempts.push({ provider: p.id, status: "failed", error: "Missing API key" });
      continue;
    }

    let reply = "";
    const providerTimeout = Math.min(TOTAL_BUDGET_MS, 12_000);
    const messages = [...(history || []), { role: "user", content: message }];

    for (let tryIndex = 0; tryIndex <= MAX_PROVIDER_RETRIES; tryIndex++) {
      try {
        reply = await executeSingleCall({
          providerInfo: p,
          messages,
          apiKey,
          timeoutMs: providerTimeout,
          fetchImpl,
        });
        breaker.state = "available";
        breaker.coolingUntil = null;
        breaker.lastSuccessTime = new Date().toISOString();
        breaker.consecutiveFailures = 0;
        attempts.push({ provider: p.id, status: "success" });
        return { reply, provider: p.provider, model: p.model, attempts };
      } catch (err) {
        lastError = err;
        const isUnrecoverable = err && [400, 401, 403, 404].includes(err.status);
        if (isUnrecoverable) {
          breaker.state = "failed";
          attempts.push({
            provider: p.id,
            status: "failed",
            error: err.message,
            statusCode: err.status,
          });
          break;
        }
        breaker.state = "cooling";
        breaker.coolingUntil = new Date(Date.now() + DEFAULT_COOLDOWN_MS).toISOString();
        if (tryIndex < MAX_PROVIDER_RETRIES) {
          attempts.push({ provider: p.id, status: "retrying", error: err.message });
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

  const error = new AIProviderError("All AI providers failed or budget was exceeded.", 503);
  error.attempts = attempts;
  throw error;
}

export default {
  PROVIDER_DEFAULTS,
  AI_PROVIDERS,
  PROVIDER_PRIORITY,
  INITIAL_WELCOME_MESSAGE,
  parseProviders,
  getProviderStatusList,
  resetBreakerState,
  getAvailableProvider,
  generateAiReply,
  executeProviderRotation,
  AIProviderError,
};