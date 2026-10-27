import crypto from "node:crypto";
import { getRuntimeAgent, getRuntimeAgents, AGENT_REGISTRY } from "../agents/registry.js";
import { buildPlan, submitTask, executeTask, approveTask, cancelTask, retryTask } from "../orchestrator/mastermind.js";
import { taskStore, ACTIVE_STATUSES } from "../tasks/taskStore.js";
import { memoryStore, MEMORY_CATEGORIES } from "../memory/memoryStore.js";
import { auditStore } from "../security/auditStore.js";
import { authorizeControlRequest, hasControlAuthority } from "../security/approval.js";
import { getIntegrations, getIntegration } from "../integrations/registry.js";
import { getNotifications, getNotificationChannels } from "../notifications/notificationService.js";
import { getSecurityPosture } from "../security/posture.js";
import { verifyProvider, getProviderStatusList, getVerificationSnapshot } from "../aiProviders.js";
import { logEvent } from "../logger.js";

const READ_LIMIT_PER_MINUTE = 120;
const WRITE_LIMIT_PER_MINUTE = 30;
const rateBuckets = new Map();

export function resetRateLimits() {
  rateBuckets.clear();
}

function now() {
  return Date.now();
}

function checkRateLimit(clientKey, method, env) {
  const limit = Number(env?.GRANDMASTER_RATE_LIMIT_PER_MINUTE) || WRITE_LIMIT_PER_MINUTE;
  const isWrite = method !== "GET" && method !== "HEAD";
  const max = isWrite ? limit : Math.max(limit * 4, READ_LIMIT_PER_MINUTE);
  const key = `${clientKey || "local"}:${isWrite ? "w" : "r"}`;
  const windowStart = now() - 60_000;
  const recent = (rateBuckets.get(key) || []).filter((time) => time > windowStart);
  if (recent.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((recent[0] + 60_000 - now()) / 1000));
    return { limited: true, retryAfter, max };
  }
  recent.push(now());
  rateBuckets.set(key, recent);
  if (rateBuckets.size > 2000) rateBuckets.clear();
  return { limited: false, retryAfter: 0, max };
}

function requestIdFrom(headers) {
  const raw = headers?.["x-request-id"] || headers?.["X-Request-Id"];
  if (typeof raw === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(raw)) return raw;
  return crypto.randomUUID();
}

function sanitizeMessage(message, fallback = "Request failed.") {
  return String(message || fallback)
    .replace(/\s+/g, " ")
    .replace(/(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{16,})/g, "[redacted]")
    .trim()
    .slice(0, 240);
}

function fail(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function bodyObject(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      throw fail(400, "INVALID_JSON", "Request body is not valid JSON.");
    }
  }
  return typeof body === "object" ? body : {};
}

function queryValue(query, key) {
  const value = query?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function storagePublic(status) {
  return {
    mode: status.mode,
    durable: status.durable,
    ephemeral: status.ephemeral,
    writable: status.writable,
    error: status.error,
  };
}

function providerSummary(env) {
  const providers = getProviderStatusList(env);
  const snapshot = getVerificationSnapshot();
  return {
    configured: providers.some((provider) => provider.configured),
    verified: snapshot?.status === "verified",
    verifiedAt: snapshot?.checkedAt || null,
    verification: snapshot
      ? {
          status: snapshot.status,
          reason: snapshot.reason,
          provider: snapshot.provider,
          model: snapshot.model,
          latencyMs: snapshot.latencyMs,
          checkedAt: snapshot.checkedAt,
        }
      : null,
    primaryModel: providers[0]?.model || null,
    providers: providers.map((provider) => ({
      id: provider.id,
      provider: provider.provider,
      model: provider.model,
      state: provider.state,
      configured: provider.configured,
    })),
  };
}

function requireAuthorization(headers, env) {
  const result = authorizeControlRequest(headers, env);
  if (!result.ok) throw fail(result.status, result.code, result.message);
  return result;
}

function matchId(segments, prefix) {
  if (segments.length === 2 && segments[0] === prefix) return segments[1];
  return null;
}

async function dispatch({ method, segments, query, headers, body, env, fetchImpl, requestId }) {
  const storageAvailable = taskStore.status().writable;
  const providerVerified = getVerificationSnapshot()?.status === "verified";
  const context = { storageAvailable, providerVerified };

  if (method === "GET" && segments.length === 1 && segments[0] === "status") {
    const runtimeAgents = getRuntimeAgents(env, context);
    return {
      status: 200,
      data: {
        service: "grandmaster-digital-hub",
        phase: 3,
        timestamp: new Date().toISOString(),
        provider: providerSummary(env),
        storage: {
          tasks: storagePublic(taskStore.status()),
          memory: storagePublic(memoryStore.status()),
          audit: storagePublic(auditStore.status()),
        },
        agents: {
          total: AGENT_REGISTRY.length,
          operational: runtimeAgents.filter((item) => item.status === "operational").length,
          advisory: runtimeAgents.filter((item) => item.status === "advisory_ready").length,
          requiresConfiguration: runtimeAgents.filter((item) => item.status === "requires_configuration").length,
          requiresVerification: runtimeAgents.filter((item) => item.status === "requires_verification").length,
          notConnected: runtimeAgents.filter((item) => item.status === "not_connected").length,
          gates: runtimeAgents.reduce((counts, item) => {
            counts[item.gate] = (counts[item.gate] || 0) + 1;
            return counts;
          }, {}),
        },
        tasks: taskStore.stats(),
        memory: memoryStore.stats(),
        notifications: getNotificationChannels(),
        controlAuthorityConfigured: hasControlAuthority(env),
        limitations: [
          "Vercel storage uses per-instance /tmp and is not durable.",
          "External integrations (WhatsApp, Binance, MT5, Fiverr, YouTube, social) are NOT CONNECTED.",
          "Real trading and money movement are LOCKED.",
          "AI provider identifiers come from configuration. GREEN requires a recorded real verification call; this status endpoint does not contact the provider.",
        ],
      },
    };
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "agents") {
    return {
      status: 200,
      data: { agents: getRuntimeAgents(env, context), count: AGENT_REGISTRY.length },
    };
  }

  const agentId = matchId(segments, "agents");
  if (method === "GET" && agentId) {
    const agent = getRuntimeAgent(agentId, env, context);
    if (!agent) throw fail(404, "UNKNOWN_AGENT", `Unknown agent: ${agentId}`);
    const tasks = taskStore.list({ agentId, limit: 10 });
    return { status: 200, data: { agent, recentTasks: tasks } };
  }

  if (method === "POST" && segments.length === 2 && segments[0] === "mastermind" && segments[1] === "plan") {
    const input = bodyObject(body);
    const plan = buildPlan(input.request, env);
    return { status: 200, data: { plan } };
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "tasks") {
    const status = String(queryValue(query, "status") || "").toUpperCase();
    const limit = queryValue(query, "limit");
    return {
      status: 200,
      data: {
        tasks: taskStore.list({
          agentId: queryValue(query, "agent") || undefined,
          status: status || undefined,
          limit,
        }),
        stats: taskStore.stats(),
      },
    };
  }

  if (method === "POST" && segments.length === 1 && segments[0] === "tasks") {
    const input = bodyObject(body);
    const result = await submitTask({
      request: input.request,
      agentId: input.agentId,
      idempotencyKey: input.idempotencyKey,
      parentTaskId: input.parentTaskId,
      depth: input.depth,
      env,
      fetchImpl,
      requestId,
    });
    if (result.locked) {
      return {
        status: 403,
        data: {
          code: "ACTION_LOCKED",
          message: "Financial execution is LOCKED by policy. No task was created.",
          plan: result.plan,
        },
        errorEnvelope: true,
      };
    }
    return {
      status: result.duplicate ? 200 : 201,
      data: {
        task: result.task,
        plan: result.plan,
        duplicate: Boolean(result.duplicate),
        approvalRequired: Boolean(result.approvalRequired),
      },
    };
  }

  const taskId = matchId(segments, "tasks");
  if (taskId && method === "GET" && segments.length === 2) {
    const task = taskStore.get(taskId);
    if (!task) throw fail(404, "TASK_NOT_FOUND", "Task not found.");
    return { status: 200, data: { task } };
  }

  if (segments.length === 3 && segments[0] === "tasks" && segments[2] === "approve" && method === "POST") {
    requireAuthorization(headers, env);
    const task = await approveTask(segments[1], { env });
    return {
      status: 200,
      data: {
        task,
        note: "Approval recorded. No external action has been performed. POST /tasks/:id/run attempts execution through implemented executors only.",
      },
    };
  }

  if (segments.length === 3 && segments[0] === "tasks" && segments[2] === "run" && method === "POST") {
    const task = await executeTask(segments[1], { env, fetchImpl, requestId });
    return { status: 200, data: { task } };
  }

  if (segments.length === 3 && segments[0] === "tasks" && segments[2] === "cancel" && method === "POST") {
    const task = await cancelTask(segments[1], { env });
    return { status: 200, data: { task } };
  }

  if (segments.length === 3 && segments[0] === "tasks" && segments[2] === "retry" && method === "POST") {
    const task = await retryTask(segments[1], { env, fetchImpl, requestId });
    return { status: 200, data: { task } };
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "memory") {
    return {
      status: 200,
      data: {
        memories: memoryStore.list({
          query: queryValue(query, "q") || "",
          category: queryValue(query, "category") || "",
          limit: queryValue(query, "limit"),
        }),
        categories: MEMORY_CATEGORIES,
        stats: memoryStore.stats(),
        storage: storagePublic(memoryStore.status()),
      },
    };
  }

  if (method === "POST" && segments.length === 1 && segments[0] === "memory") {
    requireAuthorization(headers, env);
    const input = bodyObject(body);
    const { item, duplicate } = await memoryStore.create(input);
    return { status: duplicate ? 200 : 201, data: { memory: item, duplicate } };
  }

  const memoryId = matchId(segments, "memory");
  if (memoryId && method === "PATCH") {
    requireAuthorization(headers, env);
    const input = bodyObject(body);
    const memory = await memoryStore.update(memoryId, input, { authorized: true });
    return { status: 200, data: { memory } };
  }

  if (memoryId && method === "DELETE") {
    requireAuthorization(headers, env);
    const result = await memoryStore.remove(memoryId, { authorized: true });
    return { status: 200, data: result };
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "integrations") {
    return {
      status: 200,
      data: { integrations: getIntegrations(env, { storage: taskStore.status() }) },
    };
  }

  if (segments.length === 3 && segments[0] === "integrations" && segments[2] === "test" && method === "POST") {
    const integration = getIntegration(segments[1], env, { storage: taskStore.status() });
    if (!integration) throw fail(404, "UNKNOWN_INTEGRATION", "Unknown integration.");
    if (integration.id === "notifications_in_app") {
      return {
        status: 200,
        data: {
          integrationId: integration.id,
          status: "ok",
          performed: false,
          message: "In-app notifications are local. No external request was made.",
        },
      };
    }
    if (integration.id === "ai_provider" && integration.status === "connected") {
      const verification = await verifyProvider(env, { fetchImpl, timeoutMs: 8_000 });
      return {
        status: 200,
        data: {
          integrationId: integration.id,
          status: verification.status === "verified" ? "ok" : "failed",
          performed: true,
          message:
            verification.status === "verified"
              ? "A real provider verification call succeeded."
              : verification.reason,
        },
      };
    }
    if (integration.id === "database_storage") {
      return {
        status: 200,
        data: {
          integrationId: integration.id,
          status: integration.status === "connected" ? "ok" : "degraded",
          performed: false,
          message: integration.safeTest,
          storage: storagePublic(taskStore.status()),
        },
      };
    }
    return {
      status: 200,
      data: {
        integrationId: integration.id,
        status: "not_connected",
        performed: false,
        message: integration.error || "The integration is not connected. No external request was made.",
      },
    };
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "notifications") {
    return {
      status: 200,
      data: {
        channels: getNotificationChannels(),
        notifications: getNotifications({ limit: queryValue(query, "limit") }),
      },
    };
  }

  if (method === "GET" && segments.length === 2 && segments[0] === "security" && segments[1] === "posture") {
    return {
      status: 200,
      data: {
        posture: getSecurityPosture(env, { storage: storagePublic(taskStore.status()) }),
      },
    };
  }

  if (method === "GET" && segments.length === 1 && segments[0] === "audit") {
    requireAuthorization(headers, env);
    return {
      status: 200,
      data: {
        events: auditStore.list(queryValue(query, "limit")),
        stats: auditStore.stats(),
      },
    };
  }

  throw fail(404, "ENDPOINT_NOT_FOUND", "Endpoint not found.");
}

export async function handleV1({
  method = "GET",
  path = "/",
  query = {},
  headers = {},
  body = null,
  env = process.env,
  fetchImpl,
  clientKey = "local",
} = {}) {
  const startedAt = now();
  const requestId = requestIdFrom(headers);
  const safeMethod = String(method || "GET").toUpperCase();
  const rawPath = String(path || "/").split("?")[0];
  const segments = rawPath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .slice(0, 6);

  const rate = checkRateLimit(clientKey, safeMethod, env);
  if (rate.limited) {
    logEvent({
      event: "rate_limited",
      requestId,
      status: "RATE_LIMITED",
      durationMs: now() - startedAt,
    });
    return {
      requestId,
      status: 429,
      body: {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Retry after ${rate.retryAfter} seconds.`,
        },
        requestId,
      },
      headers: { "Retry-After": String(rate.retryAfter) },
    };
  }

  try {
    const result = await dispatch({
      method: safeMethod,
      segments,
      query,
      headers,
      body,
      env,
      fetchImpl,
      requestId,
    });
    const responseBody = result.errorEnvelope
      ? {
          ok: false,
          error: { code: result.data.code, message: result.data.message },
          details: result.data.plan ? { plan: result.data.plan } : undefined,
          requestId,
        }
      : { ok: true, data: result.data, requestId };

    logEvent({
      event: "api_request",
      requestId,
      status: result.status,
      durationMs: now() - startedAt,
    });
    return { requestId, status: result.status, body: responseBody };
  } catch (error) {
    const statusCode = Number(error?.status) || 500;
    const code = error?.code || "INTERNAL_ERROR";
    const message =
      statusCode >= 500 && !error?.status
        ? "Internal server error."
        : sanitizeMessage(error?.message);

    logEvent({
      event: "api_error",
      level: statusCode >= 500 ? "error" : "warn",
      requestId,
      status: statusCode,
      durationMs: now() - startedAt,
      errorCategory: code,
    });

    return {
      requestId,
      status: statusCode,
      body: {
        ok: false,
        error: { code, message },
        requestId,
      },
    };
  }
}

export { ACTIVE_STATUSES };
