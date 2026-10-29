import crypto from "node:crypto";
import { applyCors } from "./cors.js";
import { authConfigProblem, authConfigured } from "./auth/session.js";
import { resolveSession } from "./auth/guards.js";

/**
 * Shared helpers for Vercel serverless adapters.
 * Adapters stay thin: all behaviour lives in lib/.
 */

export const API_SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
});

export function newRequestId() {
  return crypto.randomUUID();
}

export function clientKeyFrom(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req?.socket?.remoteAddress || "unknown";
}

export function queryObject(req) {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    return Object.fromEntries(url.searchParams);
  } catch {
    return {};
  }
}

export function prepare(req, res, env = process.env) {
  const headers = req.headers || {};
  const requestId =
    typeof headers["x-request-id"] === "string" &&
    /^[A-Za-z0-9._-]{1,80}$/.test(headers["x-request-id"])
      ? headers["x-request-id"]
      : newRequestId();

  res.setHeader("X-Request-Id", requestId);
  res.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(API_SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }

  applyCors(req, res, env);
  return { requestId, clientKey: clientKeyFrom(req) };
}

/**
 * Enforces the signed session cookie for private routes.
 * Returns the session on success, or null after answering 401/503.
 */
export function requireSession(req, res, env = process.env, requestId, options = {}) {
  if (!authConfigured(env)) {
    sendJson(res, 503, {
      ok: false,
      code: "AUTH_NOT_CONFIGURED",
      error: authConfigProblem(env) || "UI authentication is not configured.",
      requestId,
    });
    return null;
  }
  const session = resolveSession(req?.headers || {}, env);
  if (!session) {
    sendJson(res, 401, {
      ok: false,
      code: "AUTH_REQUIRED",
      error: "Authentication required.",
      requestId,
    });
    return null;
  }
  const requiredRole = options.role || "admin";
  if (requiredRole === "admin" && session.role !== "admin") {
    sendJson(res, 403, {
      ok: false,
      code: "ROLE_FORBIDDEN",
      error: "Admin access required.",
      requestId,
    });
    return null;
  }
  return session;
}

export function sendJson(res, status, payload, headers = {}) {
  for (const [key, value] of Object.entries(headers || {})) {
    if (value !== undefined && value !== null) res.setHeader(key, value);
  }
  res.status(status).json(payload);
}

export function methodNotAllowed(res, allow = "GET") {
  res.setHeader("Allow", allow);
  return res.status(405).json({ error: `Method not allowed. Use ${allow}.` });
}

export function isResponseClosed(res) {
  return Boolean(res.writableEnded || res.headersSent);
}
