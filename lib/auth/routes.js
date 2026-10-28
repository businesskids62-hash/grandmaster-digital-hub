import {
  authConfigProblem,
  authConfigured,
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  readSessionFromHeaders,
  SESSION_TTL_SECONDS,
  verifyPassword,
} from "./session.js";

const WINDOW_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_CLIENTS = 512;
const attempts = new Map();

export function resetAuthRateLimits() {
  attempts.clear();
}

export function checkAuthRateLimit(clientKey = "unknown", env = process.env, now = Date.now()) {
  const limit = Math.max(
    1,
    Math.floor(Number(env?.AUTH_RATE_LIMIT_PER_MINUTE) || DEFAULT_MAX_ATTEMPTS),
  );
  const key = String(clientKey || "unknown").slice(0, 120);

  if (attempts.size >= MAX_CLIENTS) {
    for (const [entryKey, times] of attempts) {
      const last = times[times.length - 1] || 0;
      if (now - last >= WINDOW_MS) attempts.delete(entryKey);
    }
    while (attempts.size >= MAX_CLIENTS) {
      const oldest = attempts.keys().next().value;
      if (oldest === undefined) break;
      attempts.delete(oldest);
    }
  }

  const recent = (attempts.get(key) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= limit) {
    attempts.set(key, recent);
    return { allowed: false, limit, retryAfter: 60 };
  }
  recent.push(now);
  attempts.set(key, recent);
  return { allowed: true, limit, retryAfter: 0 };
}

function authNotConfigured(requestId, env) {
  return {
    status: 503,
    body: {
      ok: false,
      code: "AUTH_NOT_CONFIGURED",
      error: authConfigProblem(env) || "UI authentication is not configured.",
      requestId,
    },
  };
}

export function handleLogin({ method, headers, body, env = process.env, clientKey, requestId }) {
  if (method !== "POST") {
    return {
      status: 405,
      headers: { Allow: "POST" },
      body: { ok: false, code: "METHOD_NOT_ALLOWED", error: "Method not allowed. Use POST.", requestId },
    };
  }

  if (!authConfigured(env)) return authNotConfigured(requestId, env);

  const declaredLength = Number(headers?.["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return {
      status: 413,
      body: { ok: false, code: "REQUEST_TOO_LARGE", error: "Request body is too large.", requestId },
    };
  }

  const rate = checkAuthRateLimit(clientKey, env);
  if (!rate.allowed) {
    return {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfter) },
      body: {
        ok: false,
        code: "AUTH_RATE_LIMITED",
        error: "Too many sign-in attempts. Try again in a minute.",
        retryAfter: rate.retryAfter,
        requestId,
      },
    };
  }

  const password =
    body && typeof body === "object" && !Array.isArray(body) ? body.password : undefined;
  if (typeof password !== "string" || !password) {
    return {
      status: 400,
      body: {
        ok: false,
        code: "INVALID_BODY",
        error: "A non-empty 'password' string is required.",
        requestId,
      },
    };
  }

  if (!verifyPassword(password, env)) {
    return {
      status: 401,
      body: {
        ok: false,
        code: "AUTH_INVALID_CREDENTIALS",
        error: "Invalid credentials.",
        requestId,
      },
    };
  }

  const token = createSessionToken(env);
  return {
    status: 200,
    headers: { "Set-Cookie": buildSessionCookie(token, env) },
    body: {
      ok: true,
      authenticated: true,
      expiresIn: SESSION_TTL_SECONDS,
      requestId,
    },
  };
}

export function handleSession({ headers, env = process.env, requestId }) {
  if (!authConfigured(env)) return authNotConfigured(requestId, env);
  const session = readSessionFromHeaders(headers, env);
  if (!session) {
    return {
      status: 401,
      body: { ok: false, authenticated: false, code: "AUTH_REQUIRED", error: "Authentication required.", requestId },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      authenticated: true,
      expiresAt: session.expiresAt,
      requestId,
    },
  };
}

export function handleLogout({ env = process.env, requestId }) {
  return {
    status: 200,
    headers: { "Set-Cookie": clearSessionCookie(env) },
    body: { ok: true, authenticated: false, requestId },
  };
}
