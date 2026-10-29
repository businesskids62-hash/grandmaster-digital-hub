import crypto from "node:crypto";
import { parseCookies, SESSION_TTL_SECONDS } from "./session.js";

export const CSRF_COOKIE_NAME = "gm_csrf";

export function createCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isSecure(env = process.env) {
  return (
    String(env?.NODE_ENV || "").toLowerCase() === "production" ||
    Boolean(env?.VERCEL)
  );
}

function attributes(env) {
  const secure = isSecure(env) ? "; Secure" : "";
  return `Path=/; SameSite=Strict${secure}`;
}

// Readable by JavaScript on purpose: the client mirrors it in X-CSRF-Token.
export function buildCsrfCookie(token, env = process.env) {
  return `${CSRF_COOKIE_NAME}=${token}; ${attributes(env)}; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearCsrfCookie(env = process.env) {
  return `${CSRF_COOKIE_NAME}=; ${attributes(env)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function readCsrfCookie(headers = {}) {
  const cookies = parseCookies(headers?.cookie || headers?.Cookie || "");
  return cookies[CSRF_COOKIE_NAME] || "";
}

const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export function verifyCsrf(headers = {}) {
  const header = String(headers?.["x-csrf-token"] || "").trim();
  const cookie = readCsrfCookie(headers);
  if (!TOKEN_PATTERN.test(header) || !TOKEN_PATTERN.test(cookie)) return false;
  return crypto.timingSafeEqual(
    Buffer.from(header.toLowerCase(), "hex"),
    Buffer.from(cookie.toLowerCase(), "hex"),
  );
}
