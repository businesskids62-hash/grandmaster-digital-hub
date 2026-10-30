import {
  authConfigProblem,
  authConfigured,
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  createUserSessionToken,
  SESSION_TTL_SECONDS,
  verifyPassword,
} from "./session.js";
import { resolveSession } from "./guards.js";
import {
  authenticateUser,
  changeUserPassword,
  consumePasswordReset,
  createPasswordReset,
  deleteUserAccount,
  publicUser,
  signupUser,
} from "./accounts.js";
import { getDatabase } from "../db/index.js";
import { writeAudit } from "./audit.js";
import {
  buildCsrfCookie,
  clearCsrfCookie,
  createCsrfToken,
  verifyCsrf,
} from "./csrf.js";

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

function methodNotAllowed(allow, requestId) {
  return {
    status: 405,
    headers: { Allow: allow },
    body: {
      ok: false,
      code: "METHOD_NOT_ALLOWED",
      error: `Method not allowed. Use ${allow}.`,
      requestId,
    },
  };
}

function tooLarge(requestId) {
  return {
    status: 413,
    body: { ok: false, code: "REQUEST_TOO_LARGE", error: "Request body is too large.", requestId },
  };
}

function rateLimited(rate, requestId) {
  return {
    status: 429,
    headers: { "Retry-After": String(rate.retryAfter) },
    body: {
      ok: false,
      code: "AUTH_RATE_LIMITED",
      error: "Too many attempts. Try again in a minute.",
      retryAfter: rate.retryAfter,
      requestId,
    },
  };
}

function bodyObject(body) {
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

function bodyTooLarge(headers) {
  const declared = Number(headers?.["content-length"] || 0);
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}

function sessionCookies(token, env) {
  return [buildSessionCookie(token, env), buildCsrfCookie(createCsrfToken(), env)];
}

function clearedCookies(env) {
  return [clearSessionCookie(env), clearCsrfCookie(env)];
}

function loginResponse(user, env, requestId, status = 200) {
  const token = createUserSessionToken(user, env);
  return {
    status,
    headers: { "Set-Cookie": sessionCookies(token, env) },
    body: {
      ok: true,
      authenticated: true,
      user: publicUser(user),
      expiresIn: SESSION_TTL_SECONDS,
      requestId,
    },
  };
}

function legacyLoginEnabled(env) {
  // The shared owner password is a migration fallback only. As soon as an
  // ADMIN_EMAIL is configured, per-user accounts are the only login path.
  return !String(env?.ADMIN_EMAIL || "").trim();
}

export async function handleSignup({ method, headers, body, env = process.env, clientKey, requestId }) {
  if (method !== "POST") return methodNotAllowed("POST", requestId);
  if (!authConfigured(env)) return authNotConfigured(requestId, env);
  if (bodyTooLarge(headers)) return tooLarge(requestId);

  const rate = checkAuthRateLimit(clientKey, env);
  if (!rate.allowed) return rateLimited(rate, requestId);

  const payload = bodyObject(body);
  try {
    const result = await signupUser(
      {
        email: payload.email,
        password: payload.password,
        displayName: payload.displayName,
      },
      env,
    );
    if (result.ok) {
      const response = loginResponse(result.user, env, requestId, 201);
      response.body.message = result.message;
      return response;
    }
    return {
      status: result.status || 400,
      headers: {},
      body: {
        ok: false,
        code: result.code,
        error: result.message,
        authenticated: false,
        requestId,
      },
    };
  } catch {
    return {
      status: 503,
      body: {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        error: "Account storage is unavailable right now.",
        requestId,
      },
    };
  }
}

export async function handleLogin({
  method,
  headers,
  body,
  env = process.env,
  clientKey,
  requestId,
}) {
  if (method !== "POST") return methodNotAllowed("POST", requestId);
  if (!authConfigured(env)) return authNotConfigured(requestId, env);
  if (bodyTooLarge(headers)) return tooLarge(requestId);

  const rate = checkAuthRateLimit(clientKey, env);
  if (!rate.allowed) return rateLimited(rate, requestId);

  const payload = bodyObject(body);
  const email = typeof payload.email === "string" ? payload.email : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!password) {
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

  if (email) {
    try {
      const result = await authenticateUser({ email, password }, env);
      if (!result.ok) {
        return {
          status: result.status,
          headers: result.retryAfter ? { "Retry-After": String(result.retryAfter) } : {},
          body: {
            ok: false,
            code: result.code,
            error: result.message,
            ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
            requestId,
          },
        };
      }
      return loginResponse(result.user, env, requestId, 200);
    } catch {
      return {
        status: 503,
        body: {
          ok: false,
          code: "DATABASE_UNAVAILABLE",
          error: "Account storage is unavailable right now.",
          requestId,
        },
      };
    }
  }

  // Migration path for the original single-owner password. It has no user row,
  // so it is intentionally not part of per-learner sign-in tracking.
  if (legacyLoginEnabled(env) && verifyPassword(password, env)) {
    const token = createSessionToken(env);
    return {
      status: 200,
      headers: { "Set-Cookie": sessionCookies(token, env) },
      body: {
        ok: true,
        authenticated: true,
        user: { role: "admin", email: null, legacy: true },
        expiresIn: SESSION_TTL_SECONDS,
        requestId,
      },
    };
  }

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

export async function handleSession({ headers, env = process.env, requestId }) {
  if (!authConfigured(env)) return authNotConfigured(requestId, env);
  const session = await resolveSession(headers, env);
  if (!session) {
    return {
      status: 401,
      body: {
        ok: false,
        authenticated: false,
        code: "AUTH_REQUIRED",
        error: "Authentication required.",
        requestId,
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      authenticated: true,
      user: {
        id: session.userId || null,
        email: session.email || null,
        role: session.role,
        legacy: Boolean(session.legacy),
      },
      expiresAt: session.expiresAt,
      requestId,
    },
  };
}

export async function handleLogout({ headers, env = process.env, requestId }) {
  const session = await resolveSession(headers, env);
  if (session?.userId) {
    try {
      await writeAudit(getDatabase(env), { userId: session.userId, action: "logout" });
    } catch {
      /* auditing must not block sign-out */
    }
  }
  return {
    status: 200,
    headers: { "Set-Cookie": clearedCookies(env) },
    body: { ok: true, authenticated: false, requestId },
  };
}

export async function handleForgotPassword({ method, headers, body, env = process.env, clientKey, requestId }) {
  if (method !== "POST") return methodNotAllowed("POST", requestId);
  if (bodyTooLarge(headers)) return tooLarge(requestId);
  const rate = checkAuthRateLimit(clientKey, env);
  if (!rate.allowed) return rateLimited(rate, requestId);

  const payload = bodyObject(body);
  try {
    const result = await createPasswordReset(payload.email, env);
    return {
      status: 200,
      body: {
        ok: true,
        message: result.message,
        ...(result.devToken ? { devResetToken: result.devToken } : {}),
        requestId,
      },
    };
  } catch {
    // Never reveal whether the address exists, even when storage fails.
    return {
      status: 200,
      body: {
        ok: true,
        message: "If the email is registered, a reset link has been sent.",
        requestId,
      },
    };
  }
}

export async function handleResetPassword({ method, headers, body, env = process.env, clientKey, requestId }) {
  if (method !== "POST") return methodNotAllowed("POST", requestId);
  if (bodyTooLarge(headers)) return tooLarge(requestId);
  const rate = checkAuthRateLimit(clientKey, env);
  if (!rate.allowed) return rateLimited(rate, requestId);

  const payload = bodyObject(body);
  try {
    const result = await consumePasswordReset(payload.token, payload.newPassword, env);
    if (!result.ok) {
      return {
        status: result.status,
        body: { ok: false, code: result.code, error: result.message, requestId },
      };
    }
    return { status: 200, body: { ok: true, message: result.message, requestId } };
  } catch {
    return {
      status: 400,
      body: {
        ok: false,
        code: "RESET_INVALID",
        error: "This reset link is invalid or has expired.",
        requestId,
      },
    };
  }
}

export async function handleChangePassword({ method, headers, body, env = process.env, requestId }) {
  if (method !== "POST") return methodNotAllowed("POST", requestId);
  const session = await resolveSession(headers, env);
  if (!session) {
    return {
      status: 401,
      body: { ok: false, code: "AUTH_REQUIRED", error: "Authentication required.", requestId },
    };
  }
  if (session.format !== "v2") {
    return {
      status: 403,
      body: {
        ok: false,
        code: "ACCOUNT_REQUIRED",
        error: "Sign in with an account to change its password.",
        requestId,
      },
    };
  }
  if (!verifyCsrf(headers)) {
    return {
      status: 403,
      body: { ok: false, code: "CSRF_INVALID", error: "Request could not be verified.", requestId },
    };
  }

  const payload = bodyObject(body);
  try {
    const result = await changeUserPassword(
      session.userId,
      payload.currentPassword,
      payload.newPassword,
      env,
    );
    if (!result.ok) {
      return {
        status: result.status,
        body: { ok: false, code: result.code, error: result.message, requestId },
      };
    }
    const response = loginResponse(result.user, env, requestId, 200);
    response.body.message = "Password updated.";
    return response;
  } catch {
    return {
      status: 503,
      body: {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        error: "Account storage is unavailable right now.",
        requestId,
      },
    };
  }
}

export async function handleDeleteAccount({ method, headers, body, env = process.env, requestId }) {
  if (method !== "DELETE" && method !== "POST") return methodNotAllowed("DELETE", requestId);
  const session = await resolveSession(headers, env);
  if (!session) {
    return {
      status: 401,
      body: { ok: false, code: "AUTH_REQUIRED", error: "Authentication required.", requestId },
    };
  }
  if (session.format !== "v2") {
    return {
      status: 403,
      body: {
        ok: false,
        code: "ACCOUNT_REQUIRED",
        error: "Sign in with an account to delete it.",
        requestId,
      },
    };
  }
  if (!verifyCsrf(headers)) {
    return {
      status: 403,
      body: { ok: false, code: "CSRF_INVALID", error: "Request could not be verified.", requestId },
    };
  }

  const payload = bodyObject(body);
  try {
    const result = await deleteUserAccount(session.userId, payload.password, env);
    if (!result.ok) {
      return {
        status: result.status,
        body: { ok: false, code: result.code, error: result.message, requestId },
      };
    }
    return {
      status: 200,
      headers: { "Set-Cookie": clearedCookies(env) },
      body: { ok: true, message: result.message, requestId },
    };
  } catch {
    return {
      status: 503,
      body: {
        ok: false,
        code: "DATABASE_UNAVAILABLE",
        error: "Account storage is unavailable right now.",
        requestId,
      },
    };
  }
}
