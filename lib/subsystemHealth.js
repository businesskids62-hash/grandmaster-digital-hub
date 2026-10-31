import {
  buildProviderVerificationStatus,
  getVerificationSnapshot,
  isVerificationInFlight,
} from "./aiProviders.js";
import { probeMt5Status } from "./integrations/mt5Bridge.js";
import { memoryStore as defaultMemoryStore } from "./memory/memoryStore.js";
import { auditStore as defaultAuditStore } from "./security/auditStore.js";
import { taskStore as defaultTaskStore } from "./tasks/taskStore.js";

// Each subsystem report carries its own timestamp, latency and stale flag.
// None of these endpoints triggers a provider or bridge call unless the report
// itself is a live probe, so HTTP 200 never implies the subsystem works.

export function createAiHealthReport({ env = process.env, now = Date.now() } = {}) {
  const started = Date.now();
  const payload = buildProviderVerificationStatus(env, {
    snapshot: getVerificationSnapshot(),
    inFlight: isVerificationInFlight(),
    source: "cache",
    now,
  });
  return {
    subsystem: "ai",
    ok: Boolean(payload.verified),
    status: payload.health,
    verificationStatus: payload.status,
    timestamp: new Date(now).toISOString(),
    checkedAt: payload.checkedAt,
    latencyMs: payload.latencyMs,
    queryLatencyMs: Date.now() - started,
    stale: Boolean(payload.stale),
    cached: true,
    source: payload.source,
    provider: payload.provider,
    model: payload.model,
    verifiedModel: payload.verifiedModel,
    configuredPrimaryModel: payload.configuredPrimaryModel,
    verifiedOnFallback: payload.verifiedOnFallback,
    rotationMode: payload.rotationMode,
    rotationWarning: payload.rotationWarning,
    fallbackModel: payload.fallbackModel,
    fallbackVerified: payload.fallbackVerified,
    modelList: payload.modelList,
    configured: payload.configured,
    inFlight: payload.inFlight,
    retryAfter: payload.retryAfter,
    reason: payload.reason,
  };
}

export async function createMt5HealthReport({
  env = process.env,
  fetchImpl,
  timeoutMs = 3_000,
  now = Date.now(),
} = {}) {
  const started = Date.now();
  const probe = await probeMt5Status({ env, fetchImpl, timeoutMs });
  return {
    subsystem: "mt5",
    ok: probe.status === "online",
    status: probe.status,
    readOnly: true,
    tradingLocked: true,
    configured: Boolean(probe.configured),
    reachable: Boolean(probe.reachable),
    terminalConnected: Boolean(probe.terminalConnected),
    timestamp: new Date(now).toISOString(),
    latencyMs: Date.now() - started,
    stale: probe.status !== "online",
    reasonCode: probe.reasonCode || null,
    message: probe.message || "",
  };
}

function inspectStore(store) {
  const started = Date.now();
  let status = null;
  try {
    status = store && typeof store.status === "function" ? store.status() : null;
  } catch {
    status = null;
  }
  const latencyMs = Date.now() - started;
  if (!status || typeof status !== "object") {
    return {
      ok: false,
      mode: "unavailable",
      writable: false,
      durable: false,
      ephemeral: false,
      latencyMs,
    };
  }
  return {
    ok: Boolean(status.writable),
    mode: ["durable", "ephemeral", "memory"].includes(status.mode)
      ? status.mode
      : "unknown",
    writable: Boolean(status.writable),
    durable: Boolean(status.durable),
    ephemeral: Boolean(status.ephemeral),
    latencyMs,
  };
}

export function createStorageHealthReport({
  taskStore = defaultTaskStore,
  memoryStore = defaultMemoryStore,
  auditStore = defaultAuditStore,
  now = Date.now(),
} = {}) {
  const started = Date.now();
  const stores = {
    tasks: inspectStore(taskStore),
    memory: inspectStore(memoryStore),
    audit: inspectStore(auditStore),
  };
  const writable = Object.values(stores).every((store) => store.ok);
  const durable = writable && Object.values(stores).every((store) => store.durable);
  return {
    subsystem: "storage",
    ok: writable,
    status: !writable ? "unavailable" : durable ? "durable" : "ephemeral",
    timestamp: new Date(now).toISOString(),
    latencyMs: Date.now() - started,
    stale: false,
    stores,
  };
}
