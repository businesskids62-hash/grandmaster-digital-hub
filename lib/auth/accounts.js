import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "../db/index.js";
import { writeAudit } from "./audit.js";
import { recordLoginEvent } from "./loginEvents.js";
import {
  hashPassword,
  passwordProblem,
  verifyPasswordHash,
} from "./passwords.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_DISPLAY_NAME = 80;
const MAX_FAILED_ATTEMPTS = 5;
const BASE_LOCK_MS = 5 * 60_000;
const MAX_LOCK_MS = 30 * 60_000;
const RESET_TTL_MS = 30 * 60_000;

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function emailProblem(email) {
  if (!email || email.length > MAX_EMAIL_LENGTH) return "Enter a valid email address.";
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address.";
  return null;
}

function cleanDisplayName(value) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, MAX_DISPLAY_NAME) : null;
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function lockMs(failures) {
  const extra = Math.max(0, failures - MAX_FAILED_ATTEMPTS);
  return Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** Math.min(extra, 4));
}

let timingHash = null;
function dummyHash() {
  if (!timingHash) timingHash = hashPassword("timing-equalizer-placeholder-value");
  return timingHash;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.display_name || null,
  };
}

export async function getUserById(db, userId) {
  return await db.get(
    "SELECT id, email, role, display_name, password_hash, session_version, failed_attempts, locked_until, created_at FROM users WHERE id = ?",
    [userId],
  );
}

export async function signupUser({ email, password, displayName }, env = process.env) {
  const normalized = normalizeEmail(email);
  const emailIssue = emailProblem(normalized);
  if (emailIssue) {
    return { ok: false, status: 400, code: "INVALID_EMAIL", message: emailIssue };
  }
  const passwordIssue = passwordProblem(password);
  if (passwordIssue) {
    return { ok: false, status: 400, code: "WEAK_PASSWORD", message: passwordIssue };
  }

  const db = getDatabase(env);
  // Hash before the uniqueness check so duplicate and fresh emails take a
  // similar amount of time.
  const passwordHash = hashPassword(password, env);
  const existing = await db.get("SELECT id FROM users WHERE email = ?", [normalized]);
  if (existing) {
    return {
      ok: false,
      generic: true,
      status: 200,
      code: "SIGNUP_UNAVAILABLE",
      message: "If these details can be used, the account is ready. Try signing in.",
    };
  }

  const id = randomUUID();
  const stamp = nowIso();
  try {
    await db.run(
      `INSERT INTO users
        (id, email, password_hash, role, display_name, session_version, failed_attempts, locked_until, created_at, updated_at)
       VALUES (?, ?, ?, 'student', ?, 1, 0, NULL, ?, ?)`,
      [id, normalized, passwordHash, cleanDisplayName(displayName), stamp, stamp],
    );
  } catch {
    return {
      ok: false,
      generic: true,
      status: 200,
      code: "SIGNUP_UNAVAILABLE",
      message: "If these details can be used, the account is ready. Try signing in.",
    };
  }

  // Signup returns a session, so it counts as the learner's first sign-in.
  await recordLoginEvent(db, id);
  await writeAudit(db, { userId: id, action: "signup", detail: { role: "student" } });
  return {
    ok: true,
    status: 201,
    user: await getUserById(db, id),
    message: "Account created.",
  };
}

export async function authenticateUser({ email, password }, env = process.env, now = Date.now()) {
  const db = getDatabase(env);
  const normalized = normalizeEmail(email);
  const user = normalized
    ? await db.get("SELECT * FROM users WHERE email = ?", [normalized])
    : null;

  // Always run a bcrypt comparison so unknown emails do not answer faster.
  const passwordOk = verifyPasswordHash(password, user ? user.password_hash : dummyHash());

  if (user?.locked_until) {
    const until = new Date(user.locked_until).getTime();
    if (Number.isFinite(until) && until > now) {
      return {
        ok: false,
        status: 429,
        code: "AUTH_LOCKED",
        retryAfter: Math.max(1, Math.ceil((until - now) / 1000)),
        message: "Too many attempts. Try again later.",
      };
    }
  }

  if (!user || !passwordOk) {
    if (user) {
      // Serialize the read/decide/write so concurrent failures cannot lose
      // increments, and re-check the lock inside the transaction in case a
      // sibling request locked the account after the read above.
      const outcome = await db.transaction((tx) => {
        const row = tx.get(
          "SELECT failed_attempts, locked_until FROM users WHERE id = ?",
          [user.id],
        );
        if (!row) return { locked: false, missing: true };
        const lockedUntilMs = row.locked_until
          ? new Date(row.locked_until).getTime()
          : 0;
        if (Number.isFinite(lockedUntilMs) && lockedUntilMs > now) {
          return { locked: true, lockedUntil: row.locked_until };
        }
        const failures = Number(row.failed_attempts || 0) + 1;
        const lockedUntil =
          failures >= MAX_FAILED_ATTEMPTS
            ? new Date(now + lockMs(failures)).toISOString()
            : null;
        tx.run(
          "UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?",
          [failures, lockedUntil, nowIso(now), user.id],
        );
        return { locked: false, failures, lockedUntil };
      });

      if (outcome.locked) {
        const until = new Date(outcome.lockedUntil).getTime();
        return {
          ok: false,
          status: 429,
          code: "AUTH_LOCKED",
          retryAfter: Math.max(1, Math.ceil((until - now) / 1000)),
          message: "Too many attempts. Try again later.",
        };
      }

      if (!outcome.missing) {
        await writeAudit(db, {
          userId: user.id,
          action: "login_failed",
          detail: { reason: "invalid_credentials" },
        });
      }
    }
    return {
      ok: false,
      status: 401,
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    };
  }

  await db.run(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?",
    [user.id],
  );
  await recordLoginEvent(db, user.id);
  await writeAudit(db, { userId: user.id, action: "login", detail: { role: user.role } });
  return { ok: true, user };
}

export async function changeUserPassword(userId, currentPassword, newPassword, env = process.env) {
  const db = getDatabase(env);
  const user = await getUserById(db, userId);
  if (!user || !verifyPasswordHash(currentPassword, user.password_hash)) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Current password is incorrect.",
    };
  }
  const issue = passwordProblem(newPassword);
  if (issue) return { ok: false, status: 400, code: "WEAK_PASSWORD", message: issue };

  await db.run(
    "UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?",
    [hashPassword(newPassword, env), nowIso(), userId],
  );
  await writeAudit(db, { userId, action: "password_change" });
  return { ok: true, user: await getUserById(db, userId) };
}

function resetTokenHash(token) {
  return createHash("sha256").update(String(token ?? "")).digest("hex");
}

function isProductionLike(env) {
  return (
    String(env?.NODE_ENV || "").toLowerCase() === "production" || Boolean(env?.VERCEL)
  );
}

/**
 * Creates a single-use reset token. The plaintext token is returned only in
 * development so a real email provider can be added later without changing the
 * API shape. It is never logged and never stored in plaintext.
 */
export async function createPasswordReset(email, env = process.env, now = Date.now()) {
  const db = getDatabase(env);
  const normalized = normalizeEmail(email);
  const response = {
    ok: true,
    status: 200,
    message: "If the email is registered, a reset link has been sent.",
  };

  const issue = emailProblem(normalized);
  if (issue) return response;

  const user = await db.get("SELECT id FROM users WHERE email = ?", [normalized]);
  if (!user) return response;

  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  await db.transaction((tx) => {
    tx.run(
      "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
      [nowIso(now), user.id],
    );
    tx.run(
      "INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
      [
        randomUUID(),
        user.id,
        resetTokenHash(token),
        new Date(now + RESET_TTL_MS).toISOString(),
        nowIso(now),
      ],
    );
  });
  await writeAudit(db, { userId: user.id, action: "password_reset_request" });

  if (!isProductionLike(env)) response.devToken = token;
  return response;
}

export async function consumePasswordReset(token, newPassword, env = process.env, now = Date.now()) {
  const issue = passwordProblem(newPassword);
  if (issue) return { ok: false, status: 400, code: "WEAK_PASSWORD", message: issue };

  const db = getDatabase(env);
  const row = await db.get(
    "SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?",
    [resetTokenHash(token)],
  );
  const expired =
    !row || row.used_at || new Date(row.expires_at).getTime() <= now;
  if (expired) {
    return {
      ok: false,
      status: 400,
      code: "RESET_INVALID",
      message: "This reset link is invalid or has expired.",
    };
  }

  await db.transaction((tx) => {
    const marked = tx.run(
      "UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL",
      [nowIso(now), row.id],
    );
    if (Number(marked.changes) !== 1) {
      throw new Error("RESET_ALREADY_USED");
    }
    tx.run(
      "UPDATE users SET password_hash = ?, session_version = session_version + 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
      [hashPassword(newPassword, env), nowIso(now), row.user_id],
    );
  });
  await writeAudit(db, { userId: row.user_id, action: "password_reset" });
  return { ok: true, status: 200, message: "Password updated. Sign in with the new password." };
}

export async function deleteUserAccount(userId, password, env = process.env) {
  const db = getDatabase(env);
  const user = await getUserById(db, userId);
  if (!user || !verifyPasswordHash(password, user.password_hash)) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Password is incorrect.",
    };
  }

  await db.transaction((tx) => {
    // Keep the security trail but detach it from the deleted identity.
    tx.run("UPDATE audit_log SET user_id = NULL WHERE user_id = ?", [userId]);
    tx.run("DELETE FROM users WHERE id = ?", [userId]);
  });
  return { ok: true, status: 200, message: "Account deleted." };
}
