import { createHealthReport } from "../healthStatus.js";
import {
  buildProviderVerificationStatus,
  getVerificationSnapshot,
  isVerificationInFlight,
} from "../aiProviders.js";
import {
  createMt5HealthReport,
  createStorageHealthReport,
} from "../subsystemHealth.js";
import { createStackInfo } from "./stack.js";
import {
  getActiveErrors,
  getLogBufferInfo,
  getRecentLogs,
} from "./logStore.js";

function pickAiStatus(status) {
  return {
    status: status.status,
    health: status.health,
    verified: status.verified,
    configured: status.configured,
    cached: status.cached,
    stale: status.stale,
    inFlight: status.inFlight,
    provider: status.provider,
    model: status.model,
    latencyMs: status.latencyMs,
    checkedAt: status.checkedAt,
    cacheAgeMs: status.cacheAgeMs,
    retryAfter: status.retryAfter,
    reason: status.reason,
    verificationStatus: status.verificationStatus ?? status.status,
    verifiedModel: status.verifiedModel,
    configuredPrimaryModel: status.configuredPrimaryModel,
    verifiedOnFallback: status.verifiedOnFallback,
    rotationMode: status.rotationMode,
    rotationWarning: status.rotationWarning,
    fallbackModel: status.fallbackModel,
    fallbackVerified: status.fallbackVerified,
  };
}

function pickMt5Status(status) {
  return {
    status: status.status,
    ok: status.ok,
    readOnly: status.readOnly,
    tradingLocked: status.tradingLocked,
    configured: status.configured,
    reachable: status.reachable,
    terminalConnected: status.terminalConnected,
    stale: status.stale,
    latencyMs: status.latencyMs,
    reasonCode: status.reasonCode,
    message: status.message,
  };
}

// One payload for the "Copy for Claude" debug pack. It never triggers a live
// provider verification; AI state comes from the cached snapshot. The MT5 probe
// is read-only and bounded.
export async function createDiagnosticsReport({
  env = process.env,
  requestId = "",
  uptime = process.uptime(),
  fetchImpl,
  now = Date.now(),
  logLimit = 50,
  mt5TimeoutMs = 1_500,
} = {}) {
  const started = Date.now();
  const health = createHealthReport({ env, uptime });
  const ai = buildProviderVerificationStatus(env, {
    snapshot: getVerificationSnapshot(),
    inFlight: isVerificationInFlight(),
    source: "cache",
    now,
  });
  const storage = createStorageHealthReport({ now });

  let mt5;
  try {
    mt5 = await createMt5HealthReport({
      env,
      fetchImpl,
      timeoutMs: mt5TimeoutMs,
      now,
    });
  } catch {
    mt5 = {
      status: "error",
      ok: false,
      readOnly: true,
      tradingLocked: true,
      configured: false,
      reachable: false,
      terminalConnected: false,
      stale: true,
      latencyMs: null,
      reasonCode: "MT5_PROBE_FAILED",
      message: "The MT5 health probe failed without exposing bridge details.",
    };
  }

  const logs = getRecentLogs(logLimit);
  const backend = health.body;

  return {
    ok: true,
    service: "grandmaster-digital-hub",
    timestamp: new Date(now).toISOString(),
    requestId,
    environment: {
      serverless: Boolean(env?.VERCEL),
      nodeEnv: env?.NODE_ENV || "development",
      uptimeSeconds: Math.round(Number(uptime) || 0),
    },
    services: {
      backend: {
        status: backend.ok ? "ONLINE" : "ERROR",
        health: backend.status,
        service: backend.service,
        degraded: backend.degraded,
        reasonCodes: backend.reasonCodes,
        providerStatus: backend.providerStatus,
        storageStatus: backend.storageStatus,
      },
      ai: pickAiStatus(ai),
      mt5: pickMt5Status(mt5),
      storage: {
        status: storage.status,
        ok: storage.ok,
        durable: storage.stores
          ? Object.values(storage.stores).every((store) => store.durable)
          : false,
        ephemeral: storage.stores
          ? Object.values(storage.stores).some((store) => store.ephemeral)
          : false,
        stores: storage.stores,
      },
      doctor: {
        scope: "browser-simulated",
        simulated: true,
        note: "System Doctor runs in the browser only. Its live state is added by the UI.",
      },
    },
    stack: createStackInfo(env),
    errors: getActiveErrors(20),
    logs,
    logsInfo: getLogBufferInfo(),
    limits: { logLimit },
    privacy:
      "Log messages and root causes are masked. API keys, tokens, cookies and prompts are never stored here.",
    durationMs: Date.now() - started,
  };
}
