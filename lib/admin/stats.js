import { isAdmin, resolveSession } from "../auth/guards.js";
import { getDatabase } from "../db/index.js";

/**
 * Read-only sign-in counters for the owner. Legacy owner sessions have no
 * user_id, so they count toward totalLogins but not toward unique learners.
 */
export async function readSignInStats(db) {
  const signups = Number((await db.get("SELECT COUNT(*) AS c FROM users")).c || 0);
  const totalLogins = Number((await db.get("SELECT COUNT(*) AS c FROM login_events")).c || 0);
  const uniqueSignedIn = Number(
    (
      await db.get(
        "SELECT COUNT(DISTINCT user_id) AS c FROM login_events WHERE user_id IS NOT NULL",
      )
    ).c || 0,
  );
  const today = Number(
    (
      await db.get(
        `SELECT COUNT(DISTINCT user_id) AS c FROM login_events
       WHERE user_id IS NOT NULL AND date(created_at) = date('now')`,
      )
    ).c || 0,
  );
  return { signups, totalLogins, uniqueSignedIn, today };
}

export async function handleAdminStats({
  method,
  headers = {},
  env = process.env,
  requestId,
  now = Date.now(),
}) {
  const verb = String(method || "GET").toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") {
    return {
      status: 405,
      headers: { Allow: "GET, HEAD" },
      body: {
        ok: false,
        code: "METHOD_NOT_ALLOWED",
        error: "Method not allowed. Use GET.",
        requestId,
      },
    };
  }

  const session = await resolveSession(headers, env, now);
  if (!session) {
    return {
      status: 401,
      body: {
        ok: false,
        code: "AUTH_REQUIRED",
        error: "Authentication required.",
        requestId,
      },
    };
  }
  if (!isAdmin(session)) {
    return {
      status: 403,
      body: {
        ok: false,
        code: "ROLE_FORBIDDEN",
        error: "Admin access required.",
        requestId,
      },
    };
  }

  try {
    const stats = await readSignInStats(getDatabase(env));
    return { status: 200, body: { ok: true, ...stats, requestId } };
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
