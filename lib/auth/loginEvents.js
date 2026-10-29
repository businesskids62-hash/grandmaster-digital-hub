import { randomUUID } from "node:crypto";

/**
 * Sign-in tracking must never break authentication. created_at is filled by the
 * SQLite default so events use one clock even across deployments.
 */
export function recordLoginEvent(db, userId = null) {
  if (!db) return;
  try {
    db.run("INSERT INTO login_events (id, user_id) VALUES (?, ?)", [
      randomUUID(),
      userId || null,
    ]);
  } catch {
    /* tracking is best-effort; the sign-in already succeeded */
  }
}
