import crypto from "node:crypto";
import { applyCors } from "./cors.js";

/**
 * Shared helpers for Vercel serverless adapters.
 * Adapters stay thin: all behaviour lives in lib/.
 */

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
  res.setHeader("X-Content-Type-Options", "nosniff");

  applyCors(req, res, env);
  return { requestId, clientKey: clientKeyFrom(req) };
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
