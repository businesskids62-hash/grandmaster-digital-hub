// Vercel-safe DNS fix - dynamic, no top-level import
let dnsFixed = false;
try {
  const dns =
    (await import("node:dns").then((m) => m.default || m).catch(() => null)) ||
    (typeof require !== "undefined" ? require("node:dns") : null);
  if (dns?.setDefaultResultOrder) {
    dns.setDefaultResultOrder("ipv4first");
    dnsFixed = true;
  }
} catch (e) {
  // Vercel edge or missing module - skip safely
  console.warn("[aiProviders] DNS fix skipped:", e?.message);
}

export const TOTAL_BUDGET = 30_000;
export const DEFAULT_GEMINI_BUDGET = 30_000;
export const PER_PROVIDER_BUDGET = {};

export const AI_PROVIDERS = {
  gemini: {
    id: "gemini",
    name: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-3.8-flash",
  },
  "cline-free/nemotron-1.5": {
    id: "cline-free/nemotron-2.0",
    name: "Nemotron",
    endpoint: "openrouter",
  },
  openrouter: { id: "openrouter", name: "OpenRouter" },
  groq: { id: "groq", name: "Groq" },
};

export const PROVIDER_PRIORITY = (() => {
  const raw =
    process.env.AI_PROVIDER ||
    process.env.AI_MODEL ||
    "gemini,cline-free/nemotron-2.0";
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string")
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return ["gemini", "cline-free/nemotron-2.0"];
})();

function parseProviders(input = PROVIDER_PRIORITY) {
  // Handle all types: string, array, object, undefined
  let list;
  if (Array.isArray(input)) {
    list = input;
  } else if (typeof input === "string") {
    list = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (input && typeof input === "object") {
    // If AI_PROVIDERS object passed, get keys
    list = Object.keys(input);
  } else {
    list = ["gemini"];
  }
  return list
    .map((p) => (typeof p === "string" ? p.trim() : p))
    .filter(Boolean);
}

export function getAvailableProvider() {
  const list = parseProviders();
  return list[0] || "gemini";
}

export const INITIAL_WELCOME_MESSAGE =
  "Welcome to Grandmaster Digital Hub! How can I help?";

export async function generateAiReply(prompt, opts = {}) {
  const provider = opts.provider || getAvailableProvider();
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || "";
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    return {
      error:
        "GEMINI_API_KEY not configured. Please set GEMINI_API_KEY in environment.",
      provider,
      model,
    };
  }
  const systemPrompt =
    "You are Grandmaster AI, the Mastermind. Coordinate tasks and summarize progress. Always provide helpful, concise responses. Never echo the user's prompt as your reply. Think step-by-step and provide actual insights.";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: systemPrompt + " " + prompt }],
      },
    ],
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const errText = await response.text().catch(() => "Unknown error");
      return {
        error: `Gemini API error: ${response.status}`,
        provider,
        model,
        rawError: errText.substring(0, 200),
      };
    }
    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { reply, provider, model };
  } catch (fetchError) {
    clearTimeout(timer);
    if (fetchError.name === "AbortError") {
      return {
        error: "Request to Gemini timed out after 30s.",
        provider,
        model,
      };
    }
    return { error: fetchError.message, provider, model };
  }
}

export default {
  AI_PROVIDERS,
  PROVIDER_PRIORITY,
  getAvailableProvider,
  TOTAL_BUDGET,
  dnsFixed,
};
// Also export rawList alias for legacy code that expects it
export const rawList = PROVIDER_PRIORITY;

// Backward-compatible exports required by server/server.js, aiAdapter.js, api/*.js, tests/
export class AIProviderError extends Error {
  constructor(message, status = 502, retryable = false) {
    super(message);
    this.name = "AIProviderError";
    this.status = status;
    this.retryable = retryable;
  }
}

export function resetBreakerState() {
  // No-op: circuit breaker state not tracked in minimal provider module
}

export { parseProviders };

const circuitBreakers = new Map();

function getBreaker(providerId) {
  let b = circuitBreakers.get(providerId);
  if (!b) {
    b = { state: "available", coolingUntil: null };
    circuitBreakers.set(providerId, b);
  }
  return b;
}

export function getProviderStatusList(env = process.env) {
  return (
    env && env.AI_PROVIDERS ? env.AI_PROVIDERS.split(",") : PROVIDER_PRIORITY
  )
    .filter(Boolean)
    .map((p) => p.trim())
    .map((id) => {
      const [type, model] = id.split(":");
      const b = getBreaker(id);
      return {
        id,
        provider: type || "gemini",
        model: model || "gemini-3.8-flash",
        state: b.state,
        coolingUntil: b.coolingUntil,
        configured: Boolean(env && env.GEMINI_API_KEY),
      };
    });
}

export const PROVIDER_DEFAULTS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.8-flash",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
  },
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
};

export async function executeProviderRotation({
  message,
  history = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const providers = parseProviders();
  const attempts = [];
  for (const p of providers) {
    const [type, model] = p.split(":");
    const apiKey = (env && env.GEMINI_API_KEY) || "";
    if (!apiKey) {
      attempts.push({
        provider: p,
        status: "failed",
        error: "Missing API key",
      });
      continue;
    }
    // Fallback model chain for this provider type
    const fallbackModels =
      type === "gemini"
        ? [model || "gemini-3.8-flash", "gemini-3.5-flash-lite"]
        : [
            model ||
              PROVIDER_DEFAULTS[type]?.defaultModel ||
              "gemini-3.8-flash",
          ];
    let reply = "";
    for (const fm of fallbackModels) {
      try {
        const url = `${PROVIDER_DEFAULTS[type]?.baseUrl || "https://generativelanguage.googleapis.com/v1beta"}/models/${encodeURIComponent(fm)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: message || "" }] }],
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          const isNotFound = res.status === 404 || /not found/i.test(errText);
          if (isNotFound) {
            attempts.push({
              provider: p,
              model: fm,
              status: "failed",
              error: "Model not found, trying fallback",
            });
            continue;
          }
          attempts.push({
            provider: p,
            model: fm,
            status: "failed",
            error: `HTTP ${res.status}`,
          });
          continue;
        }
        const data = await res.json();
        reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        attempts.push({ provider: p, model: fm, status: "success" });
        return { reply, provider: type, model: fm, attempts };
      } catch (err) {
        attempts.push({
          provider: p,
          model: fm,
          status: "failed",
          error: err.message,
        });
      }
    }
  }
  const err = new AIProviderError(
    "All AI providers failed or budget was exceeded.",
    503,
  );
  err.attempts = attempts;
  throw err;
}
