import { recordLog } from "./diagnostics/logStore.js";

const SILENT = String(process.env.GRANDMASTER_LOG_SILENT || "") === "1";

// Every entry gets a unique code and a human root cause so "Copy for Claude"
// has enough context without exposing credentials. logStore masks all text.
const ROOT_CAUSES = {
  AI_QUOTA_EXCEEDED: "Provider quota/rate limit exhausted (upstream 429).",
  AI_AUTH_FAILED: "Provider rejected the server API key (upstream 401/403).",
  AI_MODEL_UNAVAILABLE: "Configured model ID is not available for this key.",
  AI_TIMEOUT: "Provider call exceeded the request deadline.",
  AI_BUSY: "Local AI concurrency limit was reached.",
  AI_REQUEST_CANCELLED: "Client cancelled the request before completion.",
  ALL_PROVIDERS_FAILED: "Every configured provider attempt failed.",
  AUTH_REQUIRED: "Missing or expired signed session cookie.",
  AUTH_NOT_CONFIGURED:
    "UI session prerequisites are missing (GRANDMASTER_UI_PASSWORD / GRANDMASTER_SESSION_SECRET).",
  AUTH_INVALID_CREDENTIALS: "Wrong UI password supplied.",
  RATE_LIMITED: "Per-client request rate limit exceeded.",
  HEALTH_RATE_LIMITED: "Health or diagnostics rate limit exceeded.",
  REQUEST_TOO_LARGE: "Request body exceeded the configured size limit.",
  provider_auth: "Provider rejected the server API key.",
  provider_rate_limit: "Provider rate limit or quota was reached.",
  provider_timeout: "Provider did not answer before the timeout.",
  provider_transport: "Provider could not be reached (network/transport error).",
  provider_unavailable: "Provider is temporarily unavailable (5xx/outage).",
  model_not_found: "The configured model was not found for this API key.",
  policy_locked: "Policy blocks this action (trading or money movement).",
  STORAGE_EPHEMERAL: "Serverless /tmp is per-instance and not durable.",
};

export function rootCauseFor(event = {}) {
  for (const key of [event.errorCode, event.code, event.errorCategory, event.event]) {
    if (key && ROOT_CAUSES[key]) return ROOT_CAUSES[key];
  }
  if (event.message) return String(event.message);
  return event.level === "info" ? "No fault recorded." : "Unclassified failure.";
}

export function logEvent(event = {}) {
  const level = ["info", "warn", "error"].includes(event.level)
    ? event.level
    : "info";
  const message = String(event.message || event.error || event.event || "event");
  const rootCause = event.rootCause || rootCauseFor({ ...event, level, message });
  const record = recordLog({ ...event, level, message, rootCause });

  if (!SILENT) {
    const line = JSON.stringify({
      ts: record.ts,
      level: record.level,
      event: record.event,
      code: record.code,
      requestId: record.requestId || undefined,
      status: record.status ?? undefined,
      durationMs: record.durationMs ?? undefined,
      errorCode: record.errorCode || undefined,
      errorCategory: record.errorCategory || undefined,
      provider: record.provider || undefined,
      model: record.model || undefined,
      cached: record.cached ?? undefined,
      message: record.message || undefined,
      rootCause: record.rootCause || undefined,
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  return record;
}
