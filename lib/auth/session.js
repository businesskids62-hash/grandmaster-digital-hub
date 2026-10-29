import crypto from "node:crypto";

export const SESSION_COOKIE_NAME = "gm_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const MIN_UI_PASSWORD_LENGTH = 12;
export const MIN_SESSION_SECRET_LENGTH = 32;

function configFrom(env = process.env) {
  const secret = String(env?.GRANDMASTER_SESSION_SECRET || "");
  return {
    secret,
    configured: secret.length >= MIN_SESSION_SECRET_LENGTH,
  };
}

export function authConfigured(env = process.env) {
  return configFrom(env).configured;
}

export function authConfigProblem(env = process.env) {
  if (authConfigured(env)) return null;
  return `UI authentication requires GRANDMASTER_SESSION_SECRET (min ${MIN_SESSION_SECRET_LENGTH} chars).`;
}

function isSecureDeployment(env = process.env) {
  return (
    String(env?.NODE_ENV || "").toLowerCase() === "production" ||
    Boolean(env?.VERCEL)
  );
}

function signature(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest();
}

// Legacy owner-password check, kept for migration only. Per-user accounts use
// bcrypt hashes from lib/auth/passwords.js.
export function verifyPassword(input, env = process.env) {
  const password = String(env?.GRANDMASTER_UI_PASSWORD || "");
  if (!password) return false;
  const submitted = digest(input);
  const expected = digest(password);
  return crypto.timingSafeEqual(submitted, expected);
}

/**
 * v1 session: legacy owner login. It carries no identity, so it maps to the
 * admin role after verification. Kept so an existing owner session survives
 * the upgrade to per-user accounts.
 */
export function createSessionToken(env = process.env, now = Date.now()) {
  const { secret, configured } = configFrom(env);
  if (!configured) throw new Error("Session secret is not configured.");
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `v1.${exp}`;
  return `${payload}.${signature(payload, secret)}`;
}

/**
 * v2 session: carries the user id and their session_version. Password changes
 * and account deletion bump session_version, which invalidates old tokens.
 */
export function createUserSessionToken(user, env = process.env, now = Date.now()) {
  const { secret, configured } = configFrom(env);
  if (!configured) throw new Error("Session secret is not configured.");
  const version = Math.max(1, Math.floor(Number(user?.session_version) || 1));
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `v2.${user.id}.${version}.${exp}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionToken(token, env = process.env, now = Date.now()) {
  const { secret, configured } = configFrom(env);
  if (!configured || typeof token !== "string" || !token) return null;

  const parts = token.split(".");

  if (parts.length === 5 && parts[0] === "v2") {
    const [, userId, version, expPart, submittedHex] = parts;
    if (!/^[A-Za-z0-9-]{8,64}$/.test(userId)) return null;
    if (!/^\d{1,9}$/.test(version)) return null;
    if (!/^\d{1,12}$/.test(expPart)) return null;
    if (!/^[0-9a-f]{64}$/i.test(submittedHex)) return null;
    const exp = Number(expPart);
    if (!Number.isFinite(exp) || exp * 1000 <= now) return null;
    const payload = `v2.${userId}.${version}.${expPart}`;
    const expected = Buffer.from(signature(payload, secret), "hex");
    const submitted = Buffer.from(submittedHex, "hex");
    if (submitted.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(submitted, expected)) return null;
    return {
      format: "v2",
      userId,
      sessionVersion: Number(version),
      exp,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  if (parts.length !== 3 || parts[0] !== "v1") return null;
  if (!/^\d{1,12}$/.test(parts[1])) return null;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return null;
  if (!/^[0-9a-f]{64}$/i.test(parts[2])) return null;

  const expected = Buffer.from(signature(`v1.${parts[1]}`, secret), "hex");
  const submitted = Buffer.from(parts[2], "hex");
  if (submitted.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(submitted, expected)) return null;

  return {
    format: "v1",
    legacy: true,
    role: "admin",
    exp,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function parseCookies(header) {
  const result = {};
  if (typeof header !== "string" || !header) return result;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) result[name] = value;
  }
  return result;
}

export function readSessionFromHeaders(headers = {}, env = process.env, now = Date.now()) {
  const cookieHeader = headers?.cookie || headers?.Cookie || "";
  const cookies = parseCookies(cookieHeader);
  return verifySessionToken(cookies[SESSION_COOKIE_NAME], env, now);
}

function cookieAttributes(env) {
  const secure = isSecureDeployment(env) ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export function buildSessionCookie(token, env = process.env) {
  return `${SESSION_COOKIE_NAME}=${token}; ${cookieAttributes(env)}; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(env = process.env) {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes(env)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
