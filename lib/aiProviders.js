// Central AI provider interface.
// Model identifiers are configuration, never hardcoded in routes or UI.

import crypto from "node:crypto";

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
// Retries are in addition to the first attempt: at most 3 attempts per provider.
export const MAX_RETRIES = 2;
export const MAX_ATTEMPTS_PER_PROVIDER = MAX_RETRIES + 1;
export const RETRY_BASE_DELAY_MS = 400;
export const INLINE_RETRY_MAX_MS = 5_000;
export const LIVE_VERIFY_TTL_MS = 60_000;
export const RESPONSE_CACHE_TTL_MS = 60_000;
export const RESPONSE_CACHE_MAX = 100;
export const DEFAULT_MAX_CONCURRENCY = 4;
export const MODEL_LIST_TTL_MS = 5 * 60 * 1000;
// Only transient failures are retried. 400/401/403/404 are never retried.
export const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

let activeProviderCalls = 0;

export function getActiveProviderCalls() {
  return activeProviderCalls;
}

function maxConcurrencyFromEnv(env) {
  const raw = Number(env?.AI_MAX_CONCURRENCY);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_MAX_CONCURRENCY;
  return Math.min(16, Math.floor(raw));
}

export const CHAT_SYSTEM_PROMPT = [
  "You are Grandmaster AI, the Mastermind assistant of the Grandmaster Digital Hub.",
  "Reply in the user's language; Hinglish (Roman Urdu/Hindi mixed with English) is welcome.",
  "Be concise, concrete and honest. Say clearly when something is not configured, not verified or not permitted.",
  "You are read-only: never place, modify, close or execute trades, never move funds, and never claim such actions were performed.",
  "Never reveal, print or ask for API keys, passwords, tokens, account credentials or other private data.",
  "If a provider or capability is unavailable, explain the limitation and suggest a safe next step instead of guessing.",
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

export const DEFAULT_FALLBACK_MODEL = "gemini-flash-lite-latest";

export const PROVIDER_DEFAULTS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    // Verified against the provider list-models endpoint for this API key.
    defaultModel: "gemini-3.5-flash-lite",
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
let liveVerifyCache = null;
let liveVerifyInFlight = null;
let modelListCache = null;

function recordVerification(result) {
  const verified = result?.status === "verified";
  const state = verified
    ? "live"
    : result?.state || (result?.reason ? "unverified" : "unverified");
  const snapshot = {
    status: verified ? "verified" : "failed",
    state,
    reason: result?.reason || "",
    provider: result?.provider || null,
    model: result?.model || null,
    latencyMs: result?.latencyMs ?? null,
    retryAfter: result?.retryAfter ?? null,
    modelList: result?.modelList || null,
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

export function isSnapshotFresh(
  snapshot = verificationSnapshot,
  ttlMs = VERIFICATION_TTL_MS,
  now = Date.now(),
) {
  if (!snapshot) return false;
  const checkedAt = Date.parse(String(snapshot.checkedAt || ""));
  if (!Number.isFinite(checkedAt)) return false;
  const age = now - checkedAt;
  return age >= 0 && age <= ttlMs;
}

export function isVerificationCurrent(snapshot = verificationSnapshot) {
  if (!snapshot || snapshot.status !== "verified") return false;
  return isSnapshotFresh(snapshot);
}

function snapshotMatchesIdentity(provider, snapshot) {
  if (!provider || !snapshot) return false;
  const providerType = String(provider.provider || "").trim();
  const model = String(provider.model || "").trim();
  if (!providerType || !model) return false;
  if (String(snapshot.provider || "").trim() !== providerType) return false;
  if (String(snapshot.model || "").trim() !== model) return false;
  return true;
}

function snapshotMatchesProvider(provider, snapshot) {
  return snapshotMatchesIdentity(provider, snapshot) && isVerificationCurrent(snapshot);
}

export function quotaExceededFor(provider, snapshot = verificationSnapshot) {
  return (
    snapshotMatchesIdentity(provider, snapshot) &&
    isSnapshotFresh(snapshot) &&
    snapshot.state === "quota_exceeded"
  );
}

export function providerHealthLabel(provider, snapshot = verificationSnapshot) {
  if (!provider?.configured) return "NOT CONNECTED";
  if (snapshotMatchesProvider(provider, snapshot)) return "GREEN";
  if (quotaExceededFor(provider, snapshot)) return "QUOTA EXCEEDED";
  return "CAPABILITY NOT VERIFIED";
}

export function resetVerificationSnapshot() {
  verificationSnapshot = null;
  liveVerifyCache = null;
  liveVerifyInFlight = null;
  modelListCache = null;
}

export function resetModelListCache() {
  modelListCache = null;
}

export function resetLiveVerificationCache() {
  liveVerifyCache = null;
  liveVerifyInFlight = null;
}

export function isVerificationInFlight() {
  return Boolean(liveVerifyInFlight);
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
  // AI_MODEL / AI_FALLBACK_MODEL are the current names and take precedence.
  const explicit = [];
  if (String(env.AI_MODEL || "").trim()) explicit.push(`gemini:${String(env.AI_MODEL).trim()}`);
  if (String(env.AI_FALLBACK_MODEL || "").trim()) {
    explicit.push(`gemini:${String(env.AI_FALLBACK_MODEL).trim()}`);
  }
  if (explicit.length) return explicit;

  const configured = splitList(env.AI_PROVIDERS || env.AI_PROVIDER);
  if (configured.length) return configured;

  const legacy = [];
  if (env.GEMINI_MODEL) legacy.push(`gemini:${env.GEMINI_MODEL}`);
  if (env.GEMINI_FALLBACK_MODEL) legacy.push(`gemini:${env.GEMINI_FALLBACK_MODEL}`);
  if (legacy.length) return legacy;

  return [
    `gemini:${PROVIDER_DEFAULTS.gemini.defaultModel}`,
    `gemini:${DEFAULT_FALLBACK_MODEL}`,
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

// Free provider list-models call, cached per process so verification can check
// that every configured model ID (including the fallback) actually exists.
// The API key is sent only in a header and never written to cache or logs.
export async function fetchAvailableModels(
  env = process.env,
  { fetchImpl = globalThis.fetch, timeoutMs = 6_000, force = false, now = Date.now() } = {},
) {
  const apiKey = String(env?.GEMINI_API_KEY || env?.AI_API_KEY || "").trim();
  const checkedAt = new Date(now).toISOString();
  if (!apiKey) {
    return { ok: false, models: null, reason: "GEMINI_API_KEY is not configured.", checkedAt };
  }
  const signature = crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  if (
    !force &&
    modelListCache &&
    modelListCache.signature === signature &&
    now - modelListCache.at < MODEL_LIST_TTL_MS
  ) {
    return modelListCache.result;
  }
  if (typeof fetchImpl !== "function") {
    return { ok: false, models: null, reason: "Provider transport is unavailable.", checkedAt };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs) || 6_000));
  try {
    const response = await fetchImpl(
      `${PROVIDER_DEFAULTS.gemini.baseUrl}/models?pageSize=1000`,
      {
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (!response || !response.ok) {
      return {
        ok: false,
        models: null,
        reason: `Provider model list returned HTTP ${Number(response?.status) || 0}.`,
        checkedAt,
      };
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.models)) {
      return {
        ok: false,
        models: null,
        reason: "Provider model list returned an invalid response.",
        checkedAt,
      };
    }
    const models = data.models
      .map((model) => String(model?.name || "").replace(/^models\//, ""))
      .filter(Boolean)
      .filter((name, index, all) => all.indexOf(name) === index);
    const result = { ok: true, models, reason: "", checkedAt };
    modelListCache = { at: now, signature, result };
    return result;
  } catch (error) {
    const timedOut = error?.name === "AbortError" || error?.code === "ABORT_ERR";
    return {
      ok: false,
      models: null,
      reason: timedOut
        ? "Provider model list timed out."
        : "Provider model list could not be reached.",
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectConfiguredModels(providerIds, env, options) {
  const list = await fetchAvailableModels(env, options);
  const configured = providerIds
    .map((id) => String(id).split(":")[1])
    .filter(Boolean);
  const available = {};
  for (const model of configured) {
    available[model] = list.ok ? list.models.includes(model) : null;
  }
  return {
    ok: list.ok,
    reason: list.reason,
    checkedAt: list.checkedAt,
    available,
  };
}

function readRetryAfterSeconds(response) {
  try {
    let raw = null;
    if (response?.headers?.get) raw = response.headers.get("retry-after");
    else if (response?.headers instanceof Map) raw = response.headers.get("retry-after");
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 300);
  } catch {
    // Malformed header: fall through to exponential backoff.
  }
  return null;
}

function retryDelayMs(retryIndex, retryAfterSeconds) {
  if (retryAfterSeconds != null) return retryAfterSeconds * 1000;
  const exponential = Math.min(INLINE_RETRY_MAX_MS, RETRY_BASE_DELAY_MS * 2 ** retryIndex);
  const jitter = Math.floor(Math.random() * 150);
  return exponential + jitter;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry backoff must stop as soon as the caller cancels. The promise resolves
// false on cancellation so the rotation can stop instead of starting a new call.
function waitForRetry(ms, signal, sleep) {
  const delay = Math.max(0, Number(ms) || 0);
  const waited = Promise.resolve()
    .then(() => sleep(delay))
    .then(
      () => true,
      () => true,
    );
  if (!signal) return waited;
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
    waited.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    });
  });
}

function putProviderInCooling(id, response) {
  const breaker = getBreaker(id);
  breaker.state = "cooling";
  const retryAfterSeconds = readRetryAfterSeconds(response);
  breaker.coolingUntil = Date.now() + (retryAfterSeconds != null ? retryAfterSeconds * 1000 : 60_000);
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

export async function executeProviderRotation(options = {}) {
  const env = options.env || process.env;
  const limit = maxConcurrencyFromEnv(env);
  if (activeProviderCalls >= limit) {
    throw new AIProviderError(
      "AI is busy. Please retry shortly.",
      503,
      true,
      "AI_BUSY",
    );
  }

  activeProviderCalls += 1;
  try {
    return await runProviderRotation(options);
  } finally {
    activeProviderCalls -= 1;
  }
}

async function runProviderRotation({
  message,
  history = [],
  systemPrompt = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxOutputTokens = MAX_OUTPUT_TOKENS,
  maxRetries = MAX_RETRIES,
  totalBudgetMs = TOTAL_BUDGET,
  sleepFn = defaultSleep,
  signal: externalSignal = null,
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
  if (externalSignal?.aborted) {
    throw new AIProviderError("AI request cancelled.", 499, false, "AI_REQUEST_CANCELLED");
  }

  const safeEnv = env || {};
  const providers = parseProviders(safeEnv);
  const apiKey = String(safeEnv.GEMINI_API_KEY || safeEnv.AI_API_KEY || "").trim();
  const prompt = systemPrompt
    ? `${systemPrompt}\n\nUser request:\n${message.trim()}`
    : message.trim();
  const attempts = [];
  const started = Date.now();
  // The whole rotation (all providers, all retries) shares one deadline. A
  // caller-supplied budget can shorten it but never extend past TOTAL_BUDGET.
  const requestedBudget = Number(totalBudgetMs);
  const budgetMs =
    Number.isFinite(requestedBudget) && requestedBudget > 0
      ? Math.min(TOTAL_BUDGET, requestedBudget)
      : TOTAL_BUDGET;
  const deadline = started + budgetMs;
  const retriesAllowed = Math.max(0, Math.min(MAX_RETRIES, Number(maxRetries) || 0));
  const sleep = typeof sleepFn === "function" ? sleepFn : defaultSleep;
  let quotaSeen = false;
  let quotaRetryAfter = 0;
  let cancelled = false;

  outer: for (const id of providers) {
    if (externalSignal?.aborted) {
      cancelled = true;
      break;
    }
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

    let retryIndex = 0;
    while (true) {
      if (externalSignal?.aborted) {
        cancelled = true;
        break outer;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        attempts.push({
          provider: id,
          model: providerModel,
          status: "failed",
          statusCode: null,
          error: "Total AI request budget exhausted.",
          errorCategory: "provider_timeout",
        });
        break;
      }

      const controller = new AbortController();
      const onExternalAbort = () => {
        cancelled = true;
        controller.abort();
      };
      if (externalSignal) {
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
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

          if (statusCode === 429) quotaSeen = true;

          const retryable = RETRYABLE_STATUS.has(statusCode);
          const retryAfterSeconds = retryable ? readRetryAfterSeconds(response) : null;
          const waitMs = retryDelayMs(retryIndex, retryAfterSeconds);
          const canRetryInline =
            retryable &&
            retryIndex < retriesAllowed &&
            waitMs <= INLINE_RETRY_MAX_MS &&
            Date.now() + waitMs + 250 < deadline;
          const retryAfter = retryable
            ? (retryAfterSeconds ?? Math.max(1, Math.ceil(waitMs / 1000)))
            : null;

          attempts.push({
            provider: id,
            model: providerModel,
            status: canRetryInline ? "retrying" : "failed",
            statusCode: statusCode || null,
            error: providerMessage || `HTTP ${statusCode || "unknown"}`,
            errorCategory: category,
            ...(retryAfter != null ? { retryAfter } : {}),
            ...(retryable ? { retryable: true } : {}),
            retryIndex,
          });

          if (canRetryInline) {
            if (statusCode === 429) {
              quotaRetryAfter = Math.max(quotaRetryAfter, retryAfter);
            }
            if (!(await waitForRetry(waitMs, externalSignal, sleep))) {
              cancelled = true;
              const pending = attempts[attempts.length - 1];
              pending.status = "failed";
              pending.errorCategory = "request_cancelled";
              delete pending.retryable;
              break outer;
            }
            retryIndex += 1;
            continue;
          }

          if (statusCode === 429) {
            // Giving up on this provider: report the cooldown window.
            quotaRetryAfter = Math.max(quotaRetryAfter, retryAfterSeconds ?? 60);
            putProviderInCooling(id, response);
          } else if (statusCode >= 500) {
            putProviderInCooling(id, response);
          }
          break;
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
            error: reason
              ? `Provider returned no text (${reason}).`
              : "Provider returned an empty response.",
            errorCategory: reason ? "provider_blocked" : "provider_empty_response",
          });
          break;
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
          cached: false,
          fallbackUsed: providers.indexOf(id) > 0,
          durationMs: Date.now() - started,
        };
      } catch (error) {
        const timedOut = error?.name === "AbortError" || error?.code === "ABORT_ERR";
        const category = cancelled
          ? "request_cancelled"
          : timedOut
            ? "provider_timeout"
            : "provider_transport";
        const retryableError = !cancelled;
        const waitMs = retryDelayMs(retryIndex, null);
        const canRetryInline =
          retryableError &&
          retryIndex < retriesAllowed &&
          waitMs <= INLINE_RETRY_MAX_MS &&
          Date.now() + waitMs + 250 < deadline;

        attempts.push({
          provider: id,
          model: providerModel,
          status: canRetryInline ? "retrying" : "failed",
          statusCode: null,
          error: cancelled
            ? "Request cancelled by the client."
            : timedOut
              ? `Provider timed out after ${Math.min(timeoutMs, remaining)}ms.`
              : sanitizeErrorMessage(error?.message) || "Provider request failed.",
          errorCategory: category,
          ...(retryableError ? { retryable: true } : {}),
          retryIndex,
        });
        if (canRetryInline) {
          if (!(await waitForRetry(waitMs, externalSignal, sleep))) {
            cancelled = true;
            const pending = attempts[attempts.length - 1];
            pending.status = "failed";
            pending.errorCategory = "request_cancelled";
            delete pending.retryable;
            break outer;
          }
          retryIndex += 1;
          continue;
        }
        break;
      } finally {
        clearTimeout(timer);
        if (externalSignal) {
          externalSignal.removeEventListener("abort", onExternalAbort);
        }
      }
    }
  }

  const attemptedFallback = attempts.some(
    (attempt) => attempt.provider && attempt.provider !== providers[0],
  );

  if (cancelled) {
    const failure = new AIProviderError(
      "AI request was cancelled.",
      499,
      false,
      "AI_REQUEST_CANCELLED",
    );
    failure.attempts = attempts;
    failure.fallbackUsed = attemptedFallback;
    throw failure;
  }

  if (quotaSeen) {
    const failure = new AIProviderError(
      "AI quota or rate limit reached. Please retry later.",
      429,
      true,
      "AI_QUOTA_EXCEEDED",
    );
    failure.attempts = attempts;
    failure.retryAfter = quotaRetryAfter || 60;
    failure.fallbackUsed = attemptedFallback;
    throw failure;
  }

  const classified = classifyProviderFailures(attempts);
  const failure = new AIProviderError(
    classified.message,
    classified.status,
    classified.retryable,
    classified.code,
  );
  failure.attempts = attempts;
  failure.fallbackUsed = attemptedFallback;
  throw failure;
}

// Maps the observed failure categories to the documented public codes. Mixed
// failures stay generic; a single consistent cause gets a specific code.
function classifyProviderFailures(attempts) {
  const categories = new Set(
    attempts
      .filter((attempt) => attempt.status === "failed")
      .map((attempt) => attempt.errorCategory)
      .filter(Boolean),
  );
  if (categories.size === 1) {
    const [category] = categories;
    if (category === "provider_auth") {
      return {
        code: "AI_AUTH_FAILED",
        status: 502,
        retryable: false,
        message: "The AI provider rejected the server's API key (authentication failed).",
      };
    }
    if (category === "model_not_found") {
      return {
        code: "AI_MODEL_UNAVAILABLE",
        status: 503,
        retryable: false,
        message: "The configured AI model is not available for this API key.",
      };
    }
    if (category === "provider_timeout" || category === "provider_transport") {
      return {
        code: "AI_TIMEOUT",
        status: 504,
        retryable: true,
        message: "The AI provider did not respond before the deadline.",
      };
    }
  }
  return {
    code: "ALL_PROVIDERS_FAILED",
    status: 503,
    retryable: false,
    message: "All AI providers failed or no provider is configured.",
  };
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
      state: "not_configured",
      reason: "No AI provider is configured.",
      model: "unknown",
      providers,
    });
  }
  if (!primary.configured) {
    return recordVerification({
      status: "failed",
      state: "not_configured",
      reason: "GEMINI_API_KEY / AI_API_KEY is not set on the server.",
      provider: primary.provider,
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
      // This model can take ~20s when it "thinks"; give it room inside the 30s budget.
      timeoutMs: options.timeoutMs || 28_000,
      maxOutputTokens: 32,
      maxRetries: options.maxRetries ?? 0,
      sleepFn: options.sleepFn,
    });
    // Best effort: confirm every configured model ID (including the fallback)
    // exists for this key. A failed list call stays "unverified", never GREEN.
    const modelList = await inspectConfiguredModels(parseProviders(env), env, {
      fetchImpl,
      timeoutMs: options.modelListTimeoutMs ?? 6_000,
    });
    return recordVerification({
      status: "verified",
      state: "live",
      reason: "",
      provider: result.provider,
      model: result.model,
      latencyMs: Date.now() - started,
      modelList,
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
      provider_unavailable:
        "The provider is temporarily unavailable (high demand or outage).",
      provider_timeout: "The provider did not respond before the timeout.",
      provider_transport: "The provider could not be reached (network error).",
      provider_blocked: "The provider blocked the verification prompt.",
      provider_empty_response: "The provider returned an empty response.",
    };
    const quota =
      error?.code === "AI_QUOTA_EXCEEDED" ||
      firstFailure?.errorCategory === "provider_rate_limit";
    const configured =
      firstFailure?.errorCategory !== "provider_not_configured";
    return recordVerification({
      status: "failed",
      state: quota
        ? "quota_exceeded"
        : configured
          ? "unverified"
          : "not_configured",
      reason:
        reasonByCategory[firstFailure?.errorCategory] ||
        firstFailure?.error ||
        "Provider verification failed.",
      provider: primary.provider,
      model: primary.model,
      latencyMs: Date.now() - started,
      retryAfter: error?.retryAfter ?? null,
      providers: getProviderStatusList(env),
    });
  }
}

// /api/health and /api/ai/status may call this. A real provider call is made at
// most once per TTL (default 60s) per process to avoid burning quota.
export async function verifyProviderCached(env = process.env, options = {}) {
  const ttlMs = Number(options.ttlMs ?? LIVE_VERIFY_TTL_MS) || LIVE_VERIFY_TTL_MS;
  const signature = `${parseProviders(env).join(",")}|${Boolean(
    String(env?.GEMINI_API_KEY || env?.AI_API_KEY || "").trim(),
  )}`;
  if (
    !options.force &&
    liveVerifyCache &&
    liveVerifyCache.signature === signature &&
    Date.now() - liveVerifyCache.at < ttlMs
  ) {
    return liveVerifyCache.result;
  }

  if (liveVerifyInFlight && liveVerifyInFlight.signature === signature) {
    if (options.background) return getVerificationSnapshot();
    return liveVerifyInFlight.promise;
  }

  const { background, force, ttlMs: _ttl, ...verifyOptions } = options;
  const promise = verifyProvider(env, {
    timeoutMs: 28_000,
    maxRetries: 0,
    ...verifyOptions,
  })
    .then((result) => {
      liveVerifyCache = { at: Date.now(), signature, result };
      return result;
    })
    .finally(() => {
      if (liveVerifyInFlight?.promise === promise) liveVerifyInFlight = null;
    });

  liveVerifyInFlight = { signature, promise };
  if (background) return getVerificationSnapshot();
  return promise;
}

// Builds the honest, cache-aware status payload shared by the Express and
// Vercel routes. GREEN is only possible from a fresh successful live inference.
export function buildProviderVerificationStatus(
  env = process.env,
  { snapshot = getVerificationSnapshot(), inFlight = isVerificationInFlight(), source = "cache", now = Date.now() } = {},
) {
  const providers = getProviderStatusList(env);
  const configured = providers.some((item) => item.configured);
  const primary = providers[0] || null;
  const checkedAtMs = snapshot?.checkedAt ? Date.parse(snapshot.checkedAt) : NaN;
  const cacheAgeMs = Number.isFinite(checkedAtMs)
    ? Math.max(0, now - checkedAtMs)
    : null;
  const fresh = snapshot ? isSnapshotFresh(snapshot, LIVE_VERIFY_TTL_MS, now) : false;
  const verifiedFresh = Boolean(fresh && snapshot.status === "verified");
  const quota = Boolean(
    snapshot && (snapshot.state === "quota_exceeded" || snapshot.retryAfter),
  );

  let status;
  let health;
  let reason;
  if (!configured) {
    status = "not_configured";
    health = "NOT CONNECTED";
    reason = "GEMINI_API_KEY / AI_API_KEY is not configured on the server.";
  } else if (verifiedFresh) {
    status = "verified";
    health = "GREEN";
    reason = "";
  } else if (!snapshot) {
    status = inFlight ? "verifying" : "unverified";
    health = inFlight ? "CHECKING" : "CAPABILITY NOT VERIFIED";
    reason = inFlight
      ? "Live provider verification is running."
      : "The provider has not been verified live yet.";
  } else if (snapshot.status === "verified") {
    status = "stale";
    health = "STALE";
    reason = inFlight
      ? "Last successful verification is stale. A fresh check is running."
      : "Last successful verification is stale. Refreshing.";
  } else if (snapshot.state === "quota_exceeded" || quota) {
    status = "quota_exceeded";
    health = "QUOTA EXCEEDED";
    reason = snapshot.reason || "The provider quota or rate limit was reached.";
  } else {
    status = "failed";
    health = "CAPABILITY NOT VERIFIED";
    reason = snapshot.reason || "Provider verification failed.";
  }

  const modelList = snapshot?.modelList || null;
  const fallbackModel = providers[1]?.model || null;

  return {
    status,
    health,
    reason,
    verified: verifiedFresh,
    stale: Boolean(snapshot) && !fresh,
    inFlight: Boolean(inFlight),
    source,
    cached: source !== "live",
    configured,
    provider: snapshot?.provider || primary?.provider || "gemini",
    model: snapshot?.model || primary?.model || null,
    latencyMs: snapshot?.latencyMs ?? null,
    retryAfter: snapshot?.retryAfter ?? null,
    checkedAt: snapshot?.checkedAt || null,
    cacheAgeMs,
    fallbackModel,
    fallbackVerified: fallbackModel ? (modelList?.available?.[fallbackModel] ?? null) : null,
    modelList,
    verificationState: verifiedFresh
      ? "live_verified"
      : quota
        ? "quota_exceeded"
        : configured
          ? "configured_unverified"
          : "not_configured",
    providers,
  };
}

// Cache-first status. A provider call only happens for explicit force or when
// the cached snapshot is missing/stale, and then it runs in the background so
// the HTTP response stays fast.
export async function refreshProviderVerification(env = process.env, options = {}) {
  if (options.force === true) {
    await verifyProviderCached(env, { ...options, force: true });
    return buildProviderVerificationStatus(env, {
      snapshot: getVerificationSnapshot(),
      inFlight: false,
      source: "live",
    });
  }

  const now = Date.now();
  const snapshot = getVerificationSnapshot();
  const fresh = snapshot ? isSnapshotFresh(snapshot, LIVE_VERIFY_TTL_MS, now) : false;
  if (!fresh && !isVerificationInFlight()) {
    void verifyProviderCached(env, { ...options, background: true });
  }

  const inFlight = isVerificationInFlight();
  return buildProviderVerificationStatus(env, {
    snapshot,
    inFlight,
    source: fresh ? "cache" : inFlight ? "background" : "none",
    now,
  });
}

const replyCache = new Map();

export function resetResponseCache() {
  replyCache.clear();
}

function responseCacheKey(clientKey, message, history) {
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        clientKey: String(clientKey || "unknown"),
        message,
        history: history.slice(-MAX_HISTORY_ITEMS),
      }),
    )
    .digest("hex");
  return digest;
}

function cacheTtlFromEnv(env) {
  const raw = env?.AI_RESPONSE_CACHE_TTL_MS;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return RESPONSE_CACHE_TTL_MS;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : RESPONSE_CACHE_TTL_MS;
}

// Shared chat entry point for Express and Vercel: per-client short cache plus
// the normal provider rotation. Errors are AIProviderError instances.
export async function answerChat({
  clientKey = "unknown",
  message,
  history = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxOutputTokens = MAX_OUTPUT_TOKENS,
  maxRetries = MAX_RETRIES,
  sleepFn = defaultSleep,
  useCache = true,
  signal = null,
} = {}) {
  const safeHistory = sanitizeChatHistory(history);
  const ttlMs = cacheTtlFromEnv(env);
  const key = responseCacheKey(clientKey, String(message || ""), safeHistory);

  if (useCache && ttlMs > 0) {
    const hit = replyCache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) {
      return { ...hit.result, cached: true };
    }
    if (hit) replyCache.delete(key);
  }

  const result = await executeProviderRotation({
    message,
    history: safeHistory,
    systemPrompt: CHAT_SYSTEM_PROMPT,
    env,
    fetchImpl,
    timeoutMs,
    maxOutputTokens,
    maxRetries,
    sleepFn,
    signal,
  });

  if (useCache && ttlMs > 0) {
    if (replyCache.size >= RESPONSE_CACHE_MAX) {
      const oldest = replyCache.keys().next().value;
      if (oldest !== undefined) replyCache.delete(oldest);
    }
    replyCache.set(key, { at: Date.now(), result });
  }

  return { ...result, cached: false };
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
