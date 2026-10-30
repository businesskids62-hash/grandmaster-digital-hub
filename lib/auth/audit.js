import { randomUUID } from "node:crypto";

const ALLOWED_DETAIL_KEYS = new Set([
  "reason",
  "role",
  "courseId",
  "lessonId",
  "quizId",
  "score",
  "total",
]);

function safeDetail(detail) {
  if (!detail || typeof detail !== "object") return null;
  const clean = {};
  for (const [key, value] of Object.entries(detail)) {
    if (!ALLOWED_DETAIL_KEYS.has(key)) continue;
    if (typeof value === "string" && value.length <= 120) clean[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

/**
 * Audit rows never store passwords, tokens, emails or request bodies. Only the
 * user id, an action name and a small allow-listed detail object.
 */
export async function writeAudit(db, { userId = null, action, detail = null } = {}) {
  if (!db || typeof action !== "string" || !action) return;
  try {
    await db.run(
      "INSERT INTO audit_log (id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)",
      [randomUUID(), userId, action, safeDetail(detail), new Date().toISOString()],
    );
  } catch {
    /* auditing must not break the request path */
  }
}
