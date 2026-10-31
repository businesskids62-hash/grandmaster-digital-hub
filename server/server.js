import dns from "node:dns";
// Fix for slow/timeouting fetch on Windows: prefer IPv4 instead of waiting on broken IPv6.
dns.setDefaultResultOrder("ipv4first");

import { randomUUID } from "node:crypto";
import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  MAX_MESSAGE_CHARS,
  answerChat,
  getProviderStatusList,
  getVerificationSnapshot,
  parseProviders,
  providerHealthLabel,
  refreshProviderVerification,
  sanitizeChatHistory,
  verificationErrorCode,
  verificationHttpStatus,
  verifyProviderCached,
} from "../lib/aiProviders.js";
import { getAllowedOrigins } from "../lib/cors.js";
import { handleV1 } from "../lib/api/v1.js";
import {
  checkHealthRateLimit,
  createHealthReport,
  createLivenessReport,
  healthRateLimitHeaders,
} from "../lib/healthStatus.js";
import {
  createAiHealthReport,
  createMt5HealthReport,
  createStorageHealthReport,
} from "../lib/subsystemHealth.js";
import {
  handleChangePassword,
  handleDeleteAccount,
  handleForgotPassword,
  handleLogin,
  handleLogout,
  handleResetPassword,
  handleSession,
  handleSignup,
} from "../lib/auth/routes.js";
import { handleAcademy } from "../lib/api/academy.js";
import { handleAdminStats } from "../lib/admin/stats.js";
import { getDatabase } from "../lib/db/index.js";
import { logEvent } from "../lib/logger.js";
import { createDiagnosticsReport } from "../lib/diagnostics/report.js";
import { authConfigProblem, authConfigured } from "../lib/auth/session.js";
import { isAdmin, resolveSession } from "../lib/auth/guards.js";

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || "127.0.0.1";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX =
  Number(process.env.AI_RATE_LIMIT_PER_MINUTE) ||
  Number(process.env.RATE_LIMIT_PER_MINUTE) ||
  10;

function requestIdFrom(req) {
  const incoming = req.get?.("x-request-id");
  if (typeof incoming === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    req.requestId = requestIdFrom(req);
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(self), geolocation=()",
    );
    // The Express server only answers JSON APIs, never HTML.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  const allowedOrigins = getAllowedOrigins(process.env);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Origin not allowed by CORS."));
      },
      credentials: true,
    }),
  );

  // In-memory rate limiter for the chat endpoint
  const hits = new Map();
  function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || "unknown";
    const recent = (hits.get(key) || []).filter(
      (time) => now - time < RATE_LIMIT_WINDOW_MS,
    );

    if (recent.length >= RATE_LIMIT_MAX) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({
        error: "Too many requests. Please wait a minute and try again.",
        retryAfter: 60,
      });
    }

    recent.push(now);
    hits.set(key, recent);
    return next();
  }

  function sendResult(res, result) {
    for (const [key, value] of Object.entries(result.headers || {})) {
      res.setHeader(key, value);
    }
    return res.status(result.status).json(result.body);
  }

  function healthRateGate(req, res, next) {
    const rate = checkHealthRateLimit(req.ip, process.env);
    for (const [key, value] of Object.entries(healthRateLimitHeaders(rate))) {
      res.setHeader(key, value);
    }
    res.setHeader("Cache-Control", "no-store");
    if (!rate.allowed) {
      return res.status(429).json({
        ok: false,
        error: "Too many health requests. Try again in a minute.",
        code: "HEALTH_RATE_LIMITED",
        requestId: req.requestId,
      });
    }
    return next();
  }

  async function sessionGate(req, res, next) {
    if (!authConfigured(process.env)) {
      return res.status(503).json({
        ok: false,
        code: "AUTH_NOT_CONFIGURED",
        error:
          authConfigProblem(process.env) ||
          "UI authentication is not configured on the server.",
        requestId: req.requestId,
      });
    }
    const session = await resolveSession(req.headers, process.env);
    if (!session) {
      return res.status(401).json({
        ok: false,
        code: "AUTH_REQUIRED",
        error: "Authentication required.",
        requestId: req.requestId,
      });
    }
    if (!isAdmin(session)) {
      return res.status(403).json({
        ok: false,
        code: "ROLE_FORBIDDEN",
        error: "Admin access required.",
        requestId: req.requestId,
      });
    }
    req.session = session;
    return next();
  }

  async function academyGate(req, res, next) {
    if (!authConfigured(process.env)) {
      return res.status(503).json({
        ok: false,
        code: "AUTH_NOT_CONFIGURED",
        error:
          authConfigProblem(process.env) ||
          "UI authentication is not configured on the server.",
        requestId: req.requestId,
      });
    }
    const session = await resolveSession(req.headers, process.env);
    if (!session) {
      return res.status(401).json({
        ok: false,
        code: "AUTH_REQUIRED",
        error: "Authentication required.",
        requestId: req.requestId,
      });
    }
    req.session = session;
    return next();
  }

  app.all("/api/auth/login", async (req, res) => {
    const result = await handleLogin({
      method: req.method,
      headers: req.headers,
      body: req.body,
      env: process.env,
      clientKey: req.ip,
      requestId: req.requestId,
    });
    return sendResult(res, result);
  });

  app.all("/api/auth/session", async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).json({
        ok: false,
        code: "METHOD_NOT_ALLOWED",
        error: "Method not allowed. Use GET.",
        requestId: req.requestId,
      });
    }
    const result = await handleSession({
      headers: req.headers,
      env: process.env,
      requestId: req.requestId,
    });
    return sendResult(res, result);
  });

  app.all("/api/auth/signup", async (req, res) => {
    const result = await handleSignup({
      method: req.method,
      headers: req.headers,
      body: req.body,
      env: process.env,
      clientKey: req.ip,
      requestId: req.requestId,
    });
    return sendResult(res, result);
  });

  app.all("/api/auth/logout", async (req, res) => {
    const result = await handleLogout({
      headers: req.headers,
      env: process.env,
      requestId: req.requestId,
    });
    return sendResult(res, result);
  });

  app.all("/api/auth/forgot-password", async (req, res) => {
    const result = await handleForgotPassword({
      method: req.method,
      headers: req.headers,
      body: req.body,
      env: process.env,
      clientKey: req.ip,
      requestId: req.requestId,
    });
    return sendResult(res, result);
  });

  app.all("/api/auth/reset-password", async (req, res) => {
    const result = await handleResetPassword({
      method: req.method,
      headers: req.headers,
      body: req.body,
      env: process.env,
      clientKey: req.ip,
      requestId: req.requestId,
    });
    return sendResult(res, result);
  });

  app.all("/api/auth/change-password", async (req, res) => {
    const result = await handleChangePassword({
      method: req.method,
      headers: req.headers,
      body: req.body,
      env: process.env,
      requestId: req.requestId,
    });
    return sendResult(res, result);
  });

  app.all("/api/auth/account", async (req, res) => {
    const result = await handleDeleteAccount({
      method: req.method,
      headers: req.headers,
      body: req.body,
      env: process.env,
      requestId: req.requestId,
    });
    return sendResult(res, result);
  });

  app.all("/api/admin/stats", sessionGate, async (req, res) => {
    const result = await handleAdminStats({
      method: req.method,
      headers: req.headers,
      env: process.env,
      requestId: req.requestId,
    });
    return sendResult(res, result);
  });

  app.use("/api/academy", academyGate, async (req, res) => {
    const result = await handleAcademy({
      method: req.method,
      path: req.path,
      headers: req.headers,
      body: req.body,
      env: process.env,
      requestId: req.requestId,
    });
    return sendResult(res, result);
  });

  // Public liveness only. Never implies AI, storage, MT5 or control authority work.
  app.all("/api/health", healthRateGate, (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).json({ error: "Method not allowed. Use GET." });
    }

    const report = createLivenessReport({ uptime: process.uptime() });
    return res
      .status(report.statusCode)
      .json({ ...report.body, requestId: req.requestId });
  });

  // Private readiness. Requires the signed session cookie.
  app.all("/api/health/readiness", sessionGate, healthRateGate, (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).json({ error: "Method not allowed. Use GET." });
    }

    // One tiny cached provider call at most once per 60s; never per page render.
    void verifyProviderCached(process.env, {
      timeoutMs: 28_000,
      maxRetries: 0,
      background: true,
    });

    const report = createHealthReport({
      env: process.env,
      uptime: process.uptime(),
    });
    return res
      .status(report.statusCode)
      .json({ ...report.body, requestId: req.requestId });
  });

  // Per-subsystem health (private). Each report has its own timestamp, latency
  // and stale flag. AI answers with the honest verification code, the same way
  // the Vercel adapter does.
  app.all("/api/health/ai", sessionGate, healthRateGate, (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).json({ error: "Method not allowed. Use GET." });
    }
    const report = createAiHealthReport({ env: process.env });
    return res
      .status(verificationHttpStatus(report.verificationStatus))
      .json({ ...report, requestId: req.requestId });
  });

  app.all("/api/health/mt5", sessionGate, healthRateGate, async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).json({ error: "Method not allowed. Use GET." });
    }
    try {
      const report = await createMt5HealthReport({ env: process.env });
      return res.status(200).json({ ...report, requestId: req.requestId });
    } catch (error) {
      return next(error);
    }
  });

  app.all("/api/health/storage", sessionGate, healthRateGate, (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).json({ error: "Method not allowed. Use GET." });
    }
    const report = createStorageHealthReport();
    return res
      .status(report.ok ? 200 : 503)
      .json({ ...report, requestId: req.requestId });
  });

  // Private debug pack: masked recent logs, cached service statuses, stack and
  // active errors. Never triggers a live provider inference.
  app.all("/api/diagnostics", sessionGate, healthRateGate, async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).json({ error: "Method not allowed. Use GET." });
    }
    try {
      const requested = Number(req.query.limit);
      const logLimit =
        Number.isFinite(requested) && requested > 0
          ? Math.min(200, Math.floor(requested))
          : 50;
      const report = await createDiagnosticsReport({
        env: process.env,
        requestId: req.requestId,
        uptime: process.uptime(),
        logLimit,
      });
      return res.status(200).json(report);
    } catch (error) {
      return next(error);
    }
  });

  // Providers list & status snapshot endpoint (private)
  app.get("/api/ai/providers", sessionGate, (req, res) => {
    const snapshot = getVerificationSnapshot();
    const providers = getProviderStatusList(process.env).map((item) => ({
      ...item,
      health: providerHealthLabel(item, snapshot),
    }));
    res.json({
      providers,
      checkedAt: snapshot?.checkedAt || null,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  });

  // Cache-first verification status. `?force=1` performs one bounded live check.
  app.get("/api/ai/status", sessionGate, async (req, res, next) => {
    try {
      const force =
        req.query.force === "1" ||
        req.query.force === "true" ||
        req.query.force === "yes";
      const payload = await refreshProviderVerification(process.env, { force });
      if (force) {
        logEvent({
          level: "info",
          event: "ai_verification",
          requestId: req.requestId,
          status: payload.status,
          provider: payload.provider,
          model: payload.model,
          durationMs: payload.latencyMs,
          source: payload.source,
          message: "Provider verification refreshed on request.",
        });
      }
      return res
        .status(verificationHttpStatus(payload.status))
        .json({
          ...payload,
          ...(verificationErrorCode(payload.status)
            ? { code: verificationErrorCode(payload.status) }
            : {}),
          requestId: req.requestId,
        });
    } catch (error) {
      return next(error);
    }
  });

  // Phase 3 core API. Shared with the Vercel serverless adapter.
  // Session auth gates the route; the control token is injected server-side so
  // the shared constant-time approval check still runs without the browser
  // ever holding the token.
  app.use("/api/v1", sessionGate, async (req, res) => {
    const url = new URL(req.originalUrl, "http://localhost");
    const headers = { ...req.headers };
    const controlToken = String(process.env.GRANDMASTER_CONTROL_TOKEN || "");
    if (controlToken) headers["x-grandmaster-token"] = controlToken;
    const result = await handleV1({
      method: req.method,
      path: url.pathname.replace(/^\/api\/v1/, ""),
      query: Object.fromEntries(url.searchParams),
      headers,
      body: req.body,
      env: process.env,
      clientKey: req.ip,
    });
    res.setHeader("X-Request-Id", result.requestId);
    res.setHeader("Cache-Control", "no-store");
    for (const [key, value] of Object.entries(result.headers || {})) {
      res.setHeader(key, value);
    }
    return res.status(result.status).json(result.body);
  });

  app.post("/api/chat", sessionGate, rateLimit, async (req, res, next) => {
    const started = Date.now();
    const controller = new AbortController();
    const onClientClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClientClose);

    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res
          .status(400)
          .json({ error: "Request body must be a JSON object.", requestId: req.requestId });
      }
      const { message, history } = req.body;

      if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({
          error: "A non-empty 'message' string is required.",
          requestId: req.requestId,
        });
      }

      if (message.length > MAX_MESSAGE_CHARS) {
        return res.status(400).json({
          error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).`,
          requestId: req.requestId,
        });
      }

      if (history !== undefined && !Array.isArray(history)) {
        return res
          .status(400)
          .json({ error: "'history' must be an array.", requestId: req.requestId });
      }

      const safeHistory = sanitizeChatHistory(history);

      const result = await answerChat({
        clientKey: req.ip || "unknown",
        message: message.trim(),
        history: safeHistory,
        env: process.env,
        signal: controller.signal,
      });

      if (res.writableEnded || res.destroyed) return undefined;
      logEvent({
        level: "info",
        event: "ai_chat",
        requestId: req.requestId,
        provider: result.provider,
        model: result.model,
        cached: Boolean(result.cached),
        durationMs: Date.now() - started,
        message: "Chat completion succeeded.",
      });
      return res.json({
        reply: result.reply,
        provider: result.provider,
        model: result.model,
        cached: Boolean(result.cached),
        durationMs: Date.now() - started,
        attempts: result.attempts,
        requestId: req.requestId,
      });
    } catch (error) {
      const retryAfter = Math.ceil(Number(error?.retryAfter));
      if (res.writableEnded || res.destroyed) return undefined;
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        res.setHeader("Retry-After", String(retryAfter));
      }
      if (error?.status) {
        logEvent({
          level: "warn",
          event: "ai_chat_failed",
          requestId: req.requestId,
          errorCode: error.code || "AI_PROVIDER_ERROR",
          status: error.status,
          retryAfter:
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
          durationMs: Date.now() - started,
          retryCount: Array.isArray(error.attempts) ? error.attempts.length : 0,
          message: error.message || "AI request failed.",
        });
        return res.status(error.status).json({
          error: error.message || "AI request failed.",
          code: error.code || "AI_PROVIDER_ERROR",
          retryable: Boolean(error.retryable),
          ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
          attempts: error.attempts || [],
          fallbackUsed: Boolean(error.fallbackUsed),
          cached: false,
          durationMs: Date.now() - started,
          requestId: req.requestId,
        });
      }
      return next(error);
    } finally {
      res.removeListener("close", onClientClose);
    }
  });

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Endpoint not found.", requestId: req.requestId });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error?.status) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code || "AI_PROVIDER_ERROR",
        attempts: error.attempts || [],
        requestId: req.requestId,
      });
    }

    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({
        error: "Request body is not valid JSON.",
        requestId: req.requestId,
      });
    }

    if (error?.type === "entity.too.large") {
      return res.status(413).json({
        error: "Request body is too large.",
        requestId: req.requestId,
      });
    }

    if (error?.message === "Origin not allowed by CORS.") {
      return res.status(403).json({ error: error.message, requestId: req.requestId });
    }

    logEvent({
      level: "error",
      event: "unhandled_error",
      requestId: req.requestId,
      errorCode: error?.code || "UNHANDLED_ERROR",
      message: error?.message || "unknown",
      rootCause: error?.message || "Unhandled server exception.",
    });
    return res
      .status(500)
      .json({ error: "Internal server error.", requestId: req.requestId });
  });

  return app;
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  try {
    // Apply migrations (including login_events) before the port opens.
    await getDatabase(process.env).ready();
    console.log("Account database ready.");
  } catch {
    console.warn(
      "Account database unavailable at startup; private routes will report 503.",
    );
  }
  const app = createApp();
  const providers = parseProviders(process.env);
  const [primaryProvider, primaryModel] = (providers[0] || "").split(":");

  app.listen(PORT, HOST, () => {
    console.log("Grandmaster Backend Running - Cline bypass OK");
    console.log(`Grandmaster server listening on http://${HOST}:${PORT}`);
    console.log(`Configured AI providers (${providers.length}): ${providers.join(", ")}`);
    console.log(`Primary provider: ${primaryProvider || "gemini"} / ${primaryModel || "configured-model"}`);
    // Warm the cached live verification so the UI does not sit on "unverified".
    void verifyProviderCached(process.env, {
      timeoutMs: 28_000,
      maxRetries: 0,
      background: true,
    });
  });
}
