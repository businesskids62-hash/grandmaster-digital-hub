// Central AI provider interface.
// Model identifiers are configuration, never hardcoded in routes or UI.

let dnsFixed = false;
try {
  const dnsModule = await import("node:dns").catch(() => null);
  const dns = dnsModule?.default || dnsModule;
  if (dns?.setDefaultResultOrder) {
    dns.setDefaultResultOrder("ipv4first");
    dnsFixed = true;
  }
} catch {
  // Non-Node runtimes may not expose node:dns. This is safe to skip.
}

export const TOTAL_BUDGET = 30_000;
export const DEFAULT_GEMINI_BUDGET = 30_000;
export const PER_PROVIDER_BUDGET = {};
export const REQUEST_TIMEOUT_MS = 25_000;
export const MAX_MESSAGE_CHARS = 8_000;
export const MAX_HISTORY_ITEMS = 12;
export const MAX_OUTPUT_TOKENS = 1_024;

export const CHAT_SYSTEM_PROMPT = [
  "You are Grandmaster AI, the Mastermind of the Grandmaster Digital Hub.",
  "Coordinate tasks, give concrete and honest guidance, and state clearly when something is not configured or not permitted.",
  "Never claim that trading, money transfers or external publishing were performed.",
  "Never ask for private credentials, API keys or passwords.",
].join(" ");

export function sanitizeChatHistory(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY_ITEMS)
    .filter((item) => item && typeof item.content === "string" && item.content.trim())
    .map((item) => ({
      role: item.role === "user" ? "user" : "assistant",
      content: item.content.slice(0, MAX_MESSAGE_CHARS),
    }));
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

export const AI_PROVIDERS = {
  gemini: {
    id: "gemini",
    name: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com",
    defaultModel: PROVIDER_DEFAULTS.gemini.defaultModel,
  },
};

export class AIProviderError extends Error {
  constructor(message, status = 502, retryable = false, code = "AI_PROVIDER_ERROR") {
    super(message);
    this.name = "AIProviderError";
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

const circuitBreakers = new Map();

let verificationSnapshot = null;

function recordVerification(result) {
  const snapshot = {
    status: result?.status === "verified" ? "verified" : "failed",
    reason: result?.reason || "",
    provider: result?.provider || null,
    model: result?.model || null,
    latencyMs: result?.latencyMs ?? null,
    checkedAt: new Date().toISOString(),
  };
  verificationSnapshot = snapshot;
  return result;
}

export function getVerificationSnapshot() {
  return verificationSnapshot ? { ...verificationSnapshot } : null;
}

// Verification state is process-local. Serverless cold starts and other
// instances will not see a previous verification and must report unverified.
export const VERIFICATION_TTL_MS = 5 * 60 * 1000;

export function isVerificationCurrent(snapshot = verificationSnapshot) {
  if (!snapshot || snapshot.status !== "verified") return false;
  const checkedAt = Date.parse(String(snapshot.checkedAt || ""));
  if (!Number.isFinite(checkedAt)) return false;
  const age = Date.now() - checkedAt;
  return age >= 0 && age <= VERIFICATION_TTL_MS;
}

function snapshotMatchesProvider(provider, snapshot) {
  if (!provider || !isVerificationCurrent(snapshot)) return false;
  const providerType = String(provider.provider || "").trim();
  const model = String(provider.model || "").trim();
  if (!providerType || !model) return false;
  if (String(snapshot.provider || "").trim() !== providerType) return false;
  if (String(snapshot.model || "").trim() !== model) return false;
  return true;
}

export function providerHealthLabel(provider, snapshot = verificationSnapshot) {
  if (!provider?.configured) return "NOT CONNECTED";
  if (snapshotMatchesProvider(provider, snapshot)) return "GREEN";
  return "CAPABILITY NOT VERIFIED";
}

export function resetVerificationSnapshot() {
  verificationSnapshot = null;
}

function getBreaker(id) {
  let breaker = circuitBreakers.get(id);
  if (!breaker) {
    breaker = { state: "available", coolingUntil: null };
    circuitBreakers.set(id, breaker);
  }
  return breaker;
}

export function resetBreakerState() {
  circuitBreakers.clear();
}

function splitList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function providerEntriesFromEnv(env = {}) {
  const configured = splitList(env.AI_PROVIDERS || env.AI_PROVIDER);
  if (configured.length) return configured;

  const models = [];
  if (env.GEMINI_MODEL) models.push(`gemini:${env.GEMINI_MODEL}`);
  if (env.GEMINI_FALLBACK_MODEL) models.push(`gemini:${env.GEMINI_FALLBACK_MODEL}`);
  if (models.length) return models;

  return [
    `gemini:${PROVIDER_DEFAULTS.gemini.defaultModel}`,
    "gemini:gemini-3.5-flash-lite",
  ];
}

export function parseProviders(input = process.env) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return providerEntriesFromEnv(input).map((entry) => {
      if (entry.includes(":")) return entry;
      const type = entry.trim();
      const model = PROVIDER_DEFAULTS[type]?.defaultModel || PROVIDER_DEFAULTS.gemini.defaultModel;
      return `${type}:${model}`;
    });
  }
  return splitList(input).map((entry) => {
    if (entry.includes(":")) return entry;
    const model = PROVIDER_DEFAULTS[entry]?.defaultModel || PROVIDER_DEFAULTS.gemini.defaultModel;
    return `${entry}:${model}`;
  });
}

export const PROVIDER_PRIORITY = parseProviders(process.env);

export function getAvailableProvider() {
  return parseProviders(process.env)[0] || "gemini";
}

export function getProviderStatusList(env = process.env) {
  const safeEnv = env || {};
  const key = String(
    safeEnv.GEMINI_API_KEY || safeEnv.AI_API_KEY || "",
  ).trim();
  const keyConfigured = Boolean(key && key !== "your_gemini_api_key_here");
  const now = Date.now();

  return parseProviders(safeEnv).map((id) => {
    const [provider, model] = id.split(":");
    const breaker = getBreaker(id);
    const cooling = Boolean(breaker.coolingUntil && breaker.coolingUntil > now);
    if (!cooling) breaker.coolingUntil = null;
    return {
      id,
      provider: provider || "gemini",
      model: model || PROVIDER_DEFAULTS.gemini.defaultModel,
      state: cooling ? "cooling" : "available",
      coolingUntil: breaker.coolingUntil,
      configured: keyConfigured && (provider || "gemini") === "gemini",
    };
  });
}

function readRetryAfterMs(response) {
  try {
    let raw = null;
    if (response?.headers?.get) raw = response.headers.get("retry-after");
    else if (response?.headers instanceof Map) raw = response.headers.get("retry-after");
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 300) * 1000;
  } catch {
    // Malformed header: use the default cooldown.
  }
  return 60_000;
}

function putProviderInCooling(id, response) {
  const breaker = getBreaker(id);
  breaker.state = "cooling";
  breaker.coolingUntil = Date.now() + readRetryAfterMs(response);
}

function extractGeminiText(data) {
  if (!data || typeof data !== "object") return "";
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (part && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function blockedReason(data) {
  const reason =
    data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "";
  return typeof reason === "string" ? reason.slice(0, 80) : "";
}

function looksLikeSecret(value) {
  return /(AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z]{20,})/.test(String(value || ""));
}

function sanitizeErrorMessage(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const clipped = text.slice(0, 160);
  return looksLikeSecret(clipped) ? "Provider rejected the request." : clipped;
}

function buildHistory(history, message) {
  const safeHistory = (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY_ITEMS)
    .filter((item) => item && typeof item.content === "string" && item.content.trim())
    .map((item) => ({
      role: item.role === "user" ? "user" : "model",
      parts: [{ text: item.content.slice(0, MAX_MESSAGE_CHARS) }],
    }));
  return [...safeHistory, { role: "user", parts: [{ text: message }] }];
}

export async function executeProviderRotation({
  message,
  history = [],
  systemPrompt = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxOutputTokens = MAX_OUTPUT_TOKENS,
} = {}) {
  if (typeof message !== "string" || !message.trim()) {
    throw new AIProviderError("A non-empty message is required.", 400, false, "INVALID_INPUT");
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new AIProviderError(
      `Message is too long (max ${MAX_MESSAGE_CHARS} characters).`,
      400,
      false,
      "MESSAGE_TOO_LONG",
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new AIProviderError("AI provider transport is unavailable.", 503, false, "NO_TRANSPORT");
  }

  const safeEnv = env || {};
  const providers = parseProviders(safeEnv);
  const apiKey = String(safeEnv.GEMINI_API_KEY || safeEnv.AI_API_KEY || "").trim();
  const prompt = systemPrompt
    ? `${systemPrompt}\n\nUser request:\n${message.trim()}`
    : message.trim();
  const attempts = [];
  const started = Date.now();
  const deadline = started + TOTAL_BUDGET;

  for (const id of providers) {
    const [type, model] = id.split(":");
    const providerType = type || "gemini";
    const providerModel = model || PROVIDER_DEFAULTS.gemini.defaultModel;

    if (providerType !== "gemini") {
      attempts.push({
        provider: id,
        model: providerModel,
        status: "failed",
        statusCode: null,
        error: `Provider type "${providerType}" is not implemented.`,
        errorCategory: "provider_not_supported",
      });
      continue;
    }

    const breaker = getBreaker(id);
    if (breaker.coolingUntil && breaker.coolingUntil > Date.now()) {
      attempts.push({
        provider: id,
        model: providerModel,
        status: "cooling_skipped",
        errorCategory: "cooling",
      });
      continue;
    }

    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      attempts.push({
        provider: id,
        model: providerModel,
        status: "failed",
        statusCode: null,
        error: "GEMINI_API_KEY is not configured.",
        errorCategory: "provider_not_configured",
      });
      continue;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(timeoutMs, remaining)),
    );

    try {
      const url = `${PROVIDER_DEFAULTS.gemini.baseUrl}/models/${encodeURIComponent(providerModel)}:generateContent`;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: buildHistory(history, prompt),
          generationConfig: { maxOutputTokens },
        }),
        signal: controller.signal,
      });

      if (!response || !response.ok) {
        const statusCode = Number(response?.status) || 0;
        let data = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        const providerMessage = sanitizeErrorMessage(data?.error?.message);
        const category =
          statusCode === 401 || statusCode === 403
            ? "provider_auth"
            : statusCode === 404
              ? "model_not_found"
              : statusCode === 429
                ? "provider_rate_limit"
                : statusCode >= 500
                  ? "provider_unavailable"
                  : statusCode === 400
                    ? "provider_bad_request"
                    : "provider_error";
        attempts.push({
          provider: id,
          model: providerModel,
          status: "failed",
          statusCode: statusCode || null,
          error: providerMessage || `HTTP ${statusCode || "unknown"}`,
          errorCategory: category,
        });
        if (statusCode === 429 || statusCode >= 500) putProviderInCooling(id, response);
        continue;
      }

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      const reply = extractGeminiText(data);
      if (!reply) {
        const reason = blockedReason(data);
        attempts.push({
          provider: id,
          model: providerModel,
          status: "failed",
          statusCode: 200,
          error: reason ? `Provider returned no text (${reason}).` : "Provider returned an empty response.",
          errorCategory: reason ? "provider_blocked" : "provider_empty_response",
        });
        continue;
      }

      attempts.push({
        provider: id,
        model: providerModel,
        status: "success",
        statusCode: 200,
        errorCategory: null,
      });
      return {
        reply,
        provider: providerType,
        model: providerModel,
        attempts,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      const timedOut = error?.name === "AbortError" || error?.code === "ABORT_ERR";
      attempts.push({
        provider: id,
        model: providerModel,
        status: "failed",
        statusCode: null,
        error: timedOut
          ? `Provider timed out after ${Math.min(timeoutMs, remaining)}ms.`
          : sanitizeErrorMessage(error?.message) || "Provider request failed.",
        errorCategory: timedOut ? "provider_timeout" : "provider_transport",
      });
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  const failure = new AIProviderError(
    "All AI providers failed or no provider is configured.",
    503,
    false,
    "ALL_PROVIDERS_FAILED",
  );
  failure.attempts = attempts;
  throw failure;
}

export async function generateText({
  message,
  history = [],
  systemPrompt = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxOutputTokens = MAX_OUTPUT_TOKENS,
} = {}) {
  const result = await executeProviderRotation({
    message,
    history,
    systemPrompt,
    env,
    fetchImpl,
    timeoutMs,
    maxOutputTokens,
  });
  return result;
}

export async function verifyProvider(env = process.env, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const providers = getProviderStatusList(env);
  const primary = providers[0];
  if (!primary) {
    return recordVerification({
      status: "failed",
      reason: "No AI provider is configured.",
      model: "unknown",
      providers,
    });
  }
  if (!primary.configured) {
    return recordVerification({
      status: "failed",
      reason: "GEMINI_API_KEY / AI_API_KEY is not set on the server.",
      model: primary.model,
      providers,
    });
  }

  const started = Date.now();
  try {
    const result = await executeProviderRotation({
      message: "Reply with exactly: OK",
      env,
      fetchImpl,
      timeoutMs: options.timeoutMs || 10_000,
      maxOutputTokens: 32,
    });
    return recordVerification({
      status: "verified",
      reason: "",
      provider: result.provider,
      model: result.model,
      latencyMs: Date.now() - started,
      providers: getProviderStatusList(env),
    });
  } catch (error) {
    const firstFailure = Array.isArray(error?.attempts)
      ? error.attempts.find((attempt) => attempt.status === "failed")
      : null;
    const reasonByCategory = {
      provider_not_configured: "GEMINI_API_KEY is not configured on the server.",
      provider_auth: "The provider rejected the API key (authentication failed).",
      model_not_found: "The configured model was not found for this API key.",
      provider_rate_limit: "The provider quota or rate limit was reached.",
      provider_timeout: "The provider did not respond before the timeout.",
      provider_blocked: "The provider blocked the verification prompt.",
      provider_empty_response: "The provider returned an empty response.",
    };
    return recordVerification({
      status: "failed",
      reason:
        reasonByCategory[firstFailure?.errorCategory] ||
        firstFailure?.error ||
        "Provider verification failed.",
      model: primary.model,
      providers: getProviderStatusList(env),
    });
  }
}

// Backward-compatible helper used by older callers.
export async function generateAiReply(prompt, opts = {}) {
  const env = opts.env || process.env;
  try {
    const result = await executeProviderRotation({
      message: String(prompt || ""),
      env,
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
    return { reply: result.reply, provider: result.provider, model: result.model };
  } catch (error) {
    return {
      error: error.message,
      code: error.code,
      provider: "gemini",
      model: (opts.model || env.GEMINI_MODEL || PROVIDER_DEFAULTS.gemini.defaultModel),
    };
  }
}

export const INITIAL_WELCOME_MESSAGE = "Welcome to Grandmaster Digital Hub! How can I help?";

export default {
  AI_PROVIDERS,
  PROVIDER_PRIORITY,
  PROVIDER_DEFAULTS,
  getAvailableProvider,
  getProviderStatusList,
  executeProviderRotation,
  verifyProvider,
  TOTAL_BUDGET,
  dnsFixed,
};
