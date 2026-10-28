import crypto from "node:crypto";

const MIN_TOKEN_LENGTH = 16;
const OWNER_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const OPERATOR_HEADER = "x-grandmaster-operator-token";

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return typeof raw === "string" ? raw.trim() : "";
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function safeEqual(left, right) {
  return crypto.timingSafeEqual(digest(left), digest(right));
}

/**
 * Operator credentials are a separate authority from the control token.
 * A missing, malformed or weak map fails closed.
 */
export function parseOperatorUsers(env = process.env) {
  const raw = String(env?.GRANDMASTER_OPERATOR_USERS || "").trim();
  if (!raw) return { configured: false, users: [], error: "missing" };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { configured: false, users: [], error: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { configured: false, users: [], error: "invalid_shape" };
  }

  const users = [];
  for (const [ownerId, token] of Object.entries(parsed)) {
    if (!OWNER_PATTERN.test(ownerId)) {
      return { configured: false, users: [], error: "invalid_owner" };
    }
    if (typeof token !== "string" || token.trim().length < MIN_TOKEN_LENGTH) {
      return { configured: false, users: [], error: "weak_token" };
    }
    users.push({ ownerId, token: token.trim() });
  }
  if (!users.length) return { configured: false, users: [], error: "no_users" };
  return { configured: true, users, error: null };
}

export function operatorAuthConfigured(env = process.env) {
  return parseOperatorUsers(env).configured;
}

export function authorizeOperatorRequest(headers, env = process.env) {
  const config = parseOperatorUsers(env);
  if (!config.configured) {
    return {
      ok: false,
      status: 503,
      code: "OPERATOR_AUTH_NOT_CONFIGURED",
      message: "Operator credentials are not configured on this server.",
    };
  }

  const bearer = headerValue(headers, "authorization").replace(/^Bearer\s+/i, "");
  const provided = headerValue(headers, OPERATOR_HEADER) || bearer;
  if (!provided) {
    return {
      ok: false,
      status: 401,
      code: "OPERATOR_AUTH_REQUIRED",
      message: "An operator token is required.",
    };
  }

  let ownerId = null;
  for (const user of config.users) {
    // Compare every entry so a match does not short-circuit timing.
    if (safeEqual(provided, user.token)) ownerId = user.ownerId;
  }
  if (!ownerId) {
    return {
      ok: false,
      status: 403,
      code: "INVALID_OPERATOR_TOKEN",
      message: "The operator token is invalid.",
    };
  }
  return { ok: true, ownerId, code: "OPERATOR_AUTHORIZED" };
}

export function operatorUserCount(env = process.env) {
  return parseOperatorUsers(env).users.length;
}
