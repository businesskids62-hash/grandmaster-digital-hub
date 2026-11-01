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

export const REST_PATH_QUERY_KEY = "gm_rest";

const SUB_PATH_MAX_SEGMENTS = 6;
// Accepts an already decoded sub-path made of ordinary id characters only, so a
// crafted pathname can never smuggle traversal, a query string or a fragment
// into the route that the shared handler resolves.
const SUB_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/;

function normalizedSegments(value) {
  return String(value || "")
    .split("/")
    .filter(Boolean);
}

/**
 * Resolves the sub-path a catch-all adapter was asked for.
 *
 * Vercel's zero-config maps an `api/**\/[...path].js` file to exactly ONE URL
 * segment (`^/api/v1/([^/]+)$`), so deeper calls such as /api/v1/mt5/status or
 * /api/academy/lessons/:id/complete never reached the function. The vercel.json
 * `routes` shorten the path to that one segment for route selection only: the
 * request the function observes keeps the full original pathname, so the
 * pathname alone carries the route. `REST_PATH_QUERY_KEY` covers the degraded
 * shape, where the remainder arrives as a query parameter instead; it is only
 * appended when the pathname holds a single segment, which is what makes the
 * rewrite idempotent if both ever arrive.
 *
 * The pathname is taken from the raw request target rather than a parsed URL:
 * `new URL()` collapses percent-encoded double dots (`%2e%2e`) into a parent
 * directory, which would turn a smuggling attempt into a different route.
 */
export function subPathFrom(req, prefix) {
  const target = String(req?.url || "/");
  const rawPathname = target.split("?")[0].split("#")[0];
  if (!rawPathname.startsWith(prefix)) return "/";
  const fromPathname = normalizedSegments(rawPathname.slice(prefix.length));
  if (fromPathname.some((segment) => !SUB_PATH_SEGMENT.test(segment))) return "/";

  let fromQuery = [];
  if (fromPathname.length <= 1) {
    let rest = null;
    try {
      rest = new URL(target, "http://localhost").searchParams.get(REST_PATH_QUERY_KEY);
    } catch {
      return "/";
    }
    fromQuery = rest === null ? [] : normalizedSegments(rest);
    if (fromQuery.some((segment) => !SUB_PATH_SEGMENT.test(segment))) return "/";
  }

  const segments = [...fromPathname, ...fromQuery];
  if (segments.length > SUB_PATH_MAX_SEGMENTS) return "/";
  return segments.length ? `/${segments.join("/")}` : "/";
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
export async function requireSession(req, res, env = process.env, requestId, options = {}) {
  if (!authConfigured(env)) {
    sendJson(res, 503, {
      ok: false,
      code: "AUTH_NOT_CONFIGURED",
      error: authConfigProblem(env) || "UI authentication is not configured.",
      requestId,
    });
    return null;
  }
  const session = await resolveSession(req?.headers || {}, env);
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
