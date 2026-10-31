import {
  handleChangePassword,
  handleDeleteAccount,
  handleForgotPassword,
  handleLogin,
  handleLogout,
  handleResetPassword,
  handleSession,
  handleSignup,
} from "../auth/routes.js";
import {
  getProviderStatusList,
  getVerificationSnapshot,
  providerHealthLabel,
  refreshProviderVerification,
  verificationErrorCode,
  verificationHttpStatus,
  verifyProviderCached,
} from "../aiProviders.js";
import {
  checkHealthRateLimit,
  createHealthReport,
  healthRateLimitHeaders,
} from "../healthStatus.js";
import {
  createAiHealthReport,
  createMt5HealthReport,
  createStorageHealthReport,
} from "../subsystemHealth.js";
import { handleSubsystemHealth } from "../subsystemRoute.js";
import {
  isResponseClosed,
  prepare,
  queryObject,
  requireSession,
  sendJson,
} from "../vercelHttp.js";

/**
 * Consolidated Vercel endpoint implementations.
 *
 * Vercel's Hobby plan caps a deployment at 12 Serverless Functions, so the
 * per-endpoint adapter files under api/ are folded into three catch-all routes
 * (api/auth, api/health, api/ai) that delegate here. The request handling and
 * response shapes are the ones the previous per-file adapters produced; only
 * the dispatch is new.
 */

function parsedBody(body) {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function pathnameOf(req) {
  try {
    return new URL(req?.url || "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

// A catch-all prefix must resolve to exactly one known segment. Anything longer
// (including encoded traversal attempts) is an unknown endpoint, never a
// different route.
export function endpointSegment(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const parts = pathname.slice(prefix.length).split("/").filter(Boolean);
  return parts.length === 1 ? parts[0] : null;
}

function methodGuard(res, req, allow, requestId) {
  if (req.method === "GET" || req.method === "HEAD") return false;
  res.setHeader("Allow", allow);
  res.status(405).json({ error: "Method not allowed. Use GET.", requestId });
  return true;
}

function notFound(res, requestId) {
  return sendJson(res, 404, {
    ok: false,
    code: "ENDPOINT_NOT_FOUND",
    error: "Endpoint not found.",
    requestId,
  });
}

export async function handleAuthEndpoint(req, res) {
  const { clientKey, requestId } = prepare(req, res, process.env);
  if (isResponseClosed(res)) return;

  const segment = endpointSegment(pathnameOf(req), "/api/auth");
  const headers = req.headers || {};
  const body = parsedBody(req.body);
  const method = req.method;

  let result = null;
  switch (segment) {
    case "login":
      result = await handleLogin({ method, headers, body, env: process.env, clientKey, requestId });
      break;
    case "signup":
      result = await handleSignup({ method, headers, body, env: process.env, clientKey, requestId });
      break;
    case "forgot-password":
      result = await handleForgotPassword({ method, headers, body, env: process.env, clientKey, requestId });
      break;
    case "reset-password":
      result = await handleResetPassword({ method, headers, body, env: process.env, clientKey, requestId });
      break;
    case "change-password":
      result = await handleChangePassword({ method, headers, body, env: process.env, requestId });
      break;
    case "account":
      result = await handleDeleteAccount({ method, headers, body, env: process.env, requestId });
      break;
    case "session":
      if (methodGuard(res, req, "GET, HEAD", requestId)) return;
      result = await handleSession({ headers, env: process.env, requestId });
      break;
    case "logout":
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method not allowed. Use POST.", requestId });
      }
      result = await handleLogout({ headers, env: process.env, requestId });
      break;
    default:
      return notFound(res, requestId);
  }

  return sendJson(res, result.status, result.body, result.headers);
}

async function handleReadiness(req, res) {
  const { clientKey, requestId } = prepare(req, res, process.env);
  if (isResponseClosed(res)) return;

  if (methodGuard(res, req, "GET, HEAD", requestId)) return;
  if (!(await requireSession(req, res, process.env, requestId))) return;

  const rate = checkHealthRateLimit(clientKey, process.env);
  const rateHeaders = healthRateLimitHeaders(rate);
  if (!rate.allowed) {
    return sendJson(
      res,
      429,
      {
        ok: false,
        error: "Too many health requests. Try again in a minute.",
        code: "HEALTH_RATE_LIMITED",
        requestId,
      },
      rateHeaders,
    );
  }

  // One tiny cached provider call at most once per 60s; never per page render.
  void verifyProviderCached(process.env, {
    timeoutMs: 28_000,
    maxRetries: 0,
    background: true,
  });

  const report = createHealthReport({ env: process.env });
  return sendJson(res, report.statusCode, { ...report.body, requestId }, rateHeaders);
}

export async function handleHealthEndpoint(req, res) {
  const segment = endpointSegment(pathnameOf(req), "/api/health");

  if (segment === "readiness") return handleReadiness(req, res);
  if (segment === "ai") {
    return handleSubsystemHealth(req, res, () => createAiHealthReport({ env: process.env }));
  }
  if (segment === "mt5") {
    return handleSubsystemHealth(req, res, () => createMt5HealthReport({ env: process.env }));
  }
  if (segment === "storage") {
    return handleSubsystemHealth(req, res, () => createStorageHealthReport());
  }

  const { requestId } = prepare(req, res, process.env);
  if (isResponseClosed(res)) return;
  return notFound(res, requestId);
}

export async function handleAiEndpoint(req, res) {
  const { requestId } = prepare(req, res, process.env);
  if (isResponseClosed(res)) return;

  const segment = endpointSegment(pathnameOf(req), "/api/ai");

  if (segment === "providers") {
    if (methodGuard(res, req, "GET, HEAD", requestId)) return;
    if (!(await requireSession(req, res, process.env, requestId))) return;

    const snapshot = getVerificationSnapshot();
    return sendJson(res, 200, {
      providers: getProviderStatusList(process.env).map((item) => ({
        ...item,
        health: providerHealthLabel(item, snapshot),
      })),
      timestamp: new Date().toISOString(),
    });
  }

  if (segment === "status") {
    if (methodGuard(res, req, "GET, HEAD", requestId)) return;
    if (!(await requireSession(req, res, process.env, requestId))) return;

    const query = queryObject(req);
    const force = query.force === "1" || query.force === "true" || query.force === "yes";
    const payload = await refreshProviderVerification(process.env, { force });
    const statusCode = verificationHttpStatus(payload.status);
    const code = verificationErrorCode(payload.status);
    return sendJson(res, statusCode, {
      ...payload,
      ...(code ? { code } : {}),
      ...(statusCode === 429 && payload.retryAfter
        ? { retryAfter: payload.retryAfter, retryable: true }
        : {}),
      error: statusCode === 200 ? undefined : payload.reason || "AI verification failed.",
      requestId,
    });
  }

  return notFound(res, requestId);
}
