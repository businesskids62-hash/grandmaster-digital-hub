import { AGENT_REGISTRY } from "./agents/registry.js";
import {
  getProviderStatusList,
  getVerificationSnapshot,
  isVerificationCurrent,
  parseProviders,
  providerHealthLabel,
  quotaExceededFor,
} from "./aiProviders.js";
import { memoryStore as defaultMemoryStore } from "./memory/memoryStore.js";
import { auditStore as defaultAuditStore } from "./security/auditStore.js";
import { hasControlAuthority } from "./security/approval.js";
import { taskStore as defaultTaskStore } from "./tasks/taskStore.js";

export const HEALTH_STATUS = Object.freeze({
  GREEN: "GREEN",
  DEGRADED: "DEGRADED",
  ERROR: "ERROR",
});

export const HEALTH_REASON = Object.freeze({
  CONTROL_AUTHORITY_NOT_CONFIGURED: "CONTROL_AUTHORITY_NOT_CONFIGURED",
  TASK_STORAGE_UNAVAILABLE: "TASK_STORAGE_UNAVAILABLE",
  MEMORY_STORAGE_UNAVAILABLE: "MEMORY_STORAGE_UNAVAILABLE",
  AUDIT_STORAGE_UNAVAILABLE: "AUDIT_STORAGE_UNAVAILABLE",
  STORAGE_MEMORY_ONLY: "STORAGE_MEMORY_ONLY",
  STORAGE_EPHEMERAL: "STORAGE_EPHEMERAL",
  AI_PROVIDER_NOT_CONFIGURED: "AI_PROVIDER_NOT_CONFIGURED",
  AI_PROVIDER_NOT_LIVE_VERIFIED: "AI_PROVIDER_NOT_LIVE_VERIFIED",
  AI_PROVIDER_QUOTA_EXCEEDED: "AI_PROVIDER_QUOTA_EXCEEDED",
});

const HEALTH_RATE_WINDOW_MS = 60_000;
const HEALTH_RATE_DEFAULT = 60;
const HEALTH_RATE_MAX_CLIENTS = 512;
const healthHits = new Map();

export function checkHealthRateLimit(
  clientKey = "unknown",
  env = process.env,
  now = Date.now(),
) {
  const limit = Math.max(
    1,
    Math.floor(Number(env?.HEALTH_RATE_LIMIT_PER_MINUTE) || HEALTH_RATE_DEFAULT),
  );
  const key = String(clientKey || "unknown").slice(0, 120);

  if (healthHits.size >= HEALTH_RATE_MAX_CLIENTS) {
    for (const [entryKey, times] of healthHits) {
      const last = times[times.length - 1] || 0;
      if (now - last >= HEALTH_RATE_WINDOW_MS) healthHits.delete(entryKey);
    }
    while (healthHits.size >= HEALTH_RATE_MAX_CLIENTS) {
      const oldest = healthHits.keys().next().value;
      if (oldest === undefined) break;
      healthHits.delete(oldest);
    }
  }

  const recent = (healthHits.get(key) || []).filter(
    (time) => now - time < HEALTH_RATE_WINDOW_MS,
  );

  if (recent.length >= limit) {
    healthHits.set(key, recent);
    return { allowed: false, limit, remaining: 0, retryAfter: 60 };
  }

  recent.push(now);
  healthHits.set(key, recent);
  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - recent.length),
    retryAfter: 0,
  };
}

export function resetHealthRateLimits() {
  healthHits.clear();
}

// Public liveness only: the process answers HTTP. It deliberately says nothing
// about AI, storage, MT5 or the control authority.
export function createLivenessReport({ now = new Date(), uptime } = {}) {
  const safeUptime = Number.isFinite(uptime)
    ? Math.max(0, Math.round(uptime))
    : Math.round(process.uptime());
  return {
    statusCode: 200,
    body: {
      ok: true,
      status: "alive",
      service: "grandmaster-digital-hub",
      timestamp: now.toISOString(),
      uptime: safeUptime,
    },
  };
}

export function healthRateLimitHeaders(rate = {}) {
  return {
    "X-RateLimit-Limit": String(rate.limit ?? HEALTH_RATE_DEFAULT),
    "X-RateLimit-Remaining": String(rate.remaining ?? 0),
    ...(rate.allowed === false ? { "Retry-After": String(rate.retryAfter || 60) } : {}),
  };
}

function inspectStorage(store, unavailableCode) {
  let status = null;
  try {
    status = store && typeof store.status === "function" ? store.status() : null;
  } catch {
    status = null;
  }

  if (!status || typeof status !== "object") {
    return {
      status: "fail",
      critical: true,
      reasonCode: unavailableCode,
      mode: "unavailable",
      writable: false,
      durable: false,
      ephemeral: false,
    };
  }

  const mode = ["durable", "ephemeral", "memory"].includes(status.mode)
    ? status.mode
    : "unknown";
  const writable = Boolean(status.writable);
  const durable = Boolean(status.durable);
  const ephemeral = Boolean(status.ephemeral);
  const base = { critical: true, mode, writable, durable, ephemeral };

  if (!writable) {
    return { ...base, status: "degraded", reasonCode: HEALTH_REASON.STORAGE_MEMORY_ONLY };
  }
  if (ephemeral) {
    return { ...base, status: "degraded", reasonCode: HEALTH_REASON.STORAGE_EPHEMERAL };
  }
  return { ...base, status: "pass", reasonCode: null };
}

function inspectProvider(env) {
  const statuses = getProviderStatusList(env);
  const providers = parseProviders(env);
  const primary = statuses[0] || null;
  const [fallbackProvider, fallbackModel] = (providers[0] || "").split(":");

  const configured = statuses.some((item) => item.configured);
  // Reads the process snapshot. The HTTP health routes refresh that snapshot
  // through verifyProviderCached(), which calls the provider at most 1/60s.
  const snapshot = getVerificationSnapshot();
  const label = primary ? providerHealthLabel(primary, snapshot) : "NOT CONNECTED";
  const liveVerified = label === "GREEN" && isVerificationCurrent(snapshot);
  const quotaExceeded = primary ? quotaExceededFor(primary, snapshot) : false;

  return {
    status: liveVerified ? "pass" : "degraded",
    critical: false,
    reasonCode: liveVerified
      ? null
      : quotaExceeded
        ? HEALTH_REASON.AI_PROVIDER_QUOTA_EXCEEDED
        : configured
          ? HEALTH_REASON.AI_PROVIDER_NOT_LIVE_VERIFIED
          : HEALTH_REASON.AI_PROVIDER_NOT_CONFIGURED,
    configured,
    liveVerified,
    quotaExceeded,
    verificationState: liveVerified
      ? "live_verified"
      : quotaExceeded
        ? "quota_exceeded"
        : configured
          ? "configured_unverified"
          : "not_configured",
    provider: primary?.provider || fallbackProvider || "gemini",
    model: primary?.model || fallbackModel || "configured-model",
    verificationSource: "cached process snapshot",
    lastVerificationStatus: snapshot?.status || "none",
    lastVerificationAt: snapshot?.checkedAt || null,
    lastVerificationRetryAfter: snapshot?.retryAfter ?? null,
    providerStatus: label,
    providersCount: providers.length,
  };
}

export function createHealthReport({
  env = process.env,
  uptime,
  now = new Date(),
  taskStore = defaultTaskStore,
  memoryStore = defaultMemoryStore,
  auditStore = defaultAuditStore,
  controlAuthority = hasControlAuthority,
} = {}) {
  const safeUptime = Number.isFinite(uptime)
    ? Math.max(0, Math.round(uptime))
    : Math.round(process.uptime());

  let authorityConfigured = false;
  try {
    authorityConfigured = Boolean(controlAuthority(env));
  } catch {
    authorityConfigured = false;
  }

  const processCheck = {
    status: "pass",
    critical: true,
    reasonCode: null,
    uptimeSeconds: safeUptime,
  };
  const controlCheck = {
    status: authorityConfigured ? "pass" : "fail",
    critical: true,
    reasonCode: authorityConfigured
      ? null
      : HEALTH_REASON.CONTROL_AUTHORITY_NOT_CONFIGURED,
    configured: authorityConfigured,
  };
  const taskStorage = inspectStorage(taskStore, HEALTH_REASON.TASK_STORAGE_UNAVAILABLE);
  const memoryStorage = inspectStorage(
    memoryStore,
    HEALTH_REASON.MEMORY_STORAGE_UNAVAILABLE,
  );
  const auditStorage = inspectStorage(auditStore, HEALTH_REASON.AUDIT_STORAGE_UNAVAILABLE);
  const aiProvider = inspectProvider(env);

  const checks = {
    process: processCheck,
    controlAuthority: controlCheck,
    taskStorage,
    memoryStorage,
    auditStorage,
    aiProvider,
  };

  const coreFailed = [
    processCheck,
    controlCheck,
    taskStorage,
    memoryStorage,
    auditStorage,
  ].some((check) => check.status === "fail");
  const degraded = Object.values(checks).some(
    (check) => check.status === "degraded",
  );
  const status = coreFailed
    ? HEALTH_STATUS.ERROR
    : degraded
      ? HEALTH_STATUS.DEGRADED
      : HEALTH_STATUS.GREEN;

  const reasonCodes = [
    ...new Set(Object.values(checks).map((check) => check.reasonCode).filter(Boolean)),
  ];

  const storageStatus =
    taskStorage.status === "fail" || !taskStorage.writable
      ? "DATA REQUIRED"
      : taskStorage.durable
        ? "GREEN"
        : "CAPABILITY NOT VERIFIED";

  return {
    statusCode: coreFailed ? 503 : 200,
    body: {
      ok: !coreFailed,
      status,
      service: coreFailed ? HEALTH_STATUS.ERROR : HEALTH_STATUS.GREEN,
      degraded: status === HEALTH_STATUS.DEGRADED,
      reasonCodes,
      providerStatus: aiProvider.providerStatus,
      storageStatus,
      uptime: safeUptime,
      timestamp: now.toISOString(),
      provider: aiProvider.provider,
      model: aiProvider.model,
      primary: aiProvider.model,
      aiConfigured: aiProvider.configured,
      providersCount: aiProvider.providersCount,
      agentsCount: AGENT_REGISTRY.length,
      storage: {
        mode: taskStorage.mode,
        durable: taskStorage.durable,
        ephemeral: taskStorage.ephemeral,
        writable: taskStorage.writable,
      },
      checks,
      verification: {
        provider: aiProvider.verificationState,
        liveVerified: aiProvider.liveVerified,
        source: aiProvider.verificationSource,
        liveProviderCall: false,
        note: "Health reports a cached provider snapshot. The health routes refresh it with one tiny provider call, at most once per 60 seconds.",
      },
    },
  };
}
