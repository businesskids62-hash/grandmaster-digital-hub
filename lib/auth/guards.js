import { getDatabase } from "../db/index.js";
import { readSessionFromHeaders } from "./session.js";

const ROLES = new Set(["admin", "student"]);

/**
 * Resolves the signed cookie into an identity.
 * v1 (legacy owner) sessions map to admin. v2 sessions must match a live user
 * row whose session_version still equals the token claim.
 */
export function resolveSession(headers = {}, env = process.env, now = Date.now()) {
  const base = readSessionFromHeaders(headers, env, now);
  if (!base) return null;

  if (base.format === "v1") {
    return { ...base, role: "admin", userId: null, email: null };
  }

  try {
    const db = getDatabase(env);
    const user = db.get(
      "SELECT id, email, role, session_version FROM users WHERE id = ?",
      [base.userId],
    );
    if (!user) return null;
    if (Number(user.session_version) !== Number(base.sessionVersion)) return null;
    if (!ROLES.has(user.role)) return null;
    return {
      ...base,
      role: user.role,
      userId: user.id,
      email: user.email,
    };
  } catch {
    // Fail closed if the database cannot be read.
    return null;
  }
}

export function isAdmin(session) {
  return session?.role === "admin";
}
