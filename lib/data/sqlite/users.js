import {
  REPOSITORY_ERROR_CODES,
  RepositoryError,
  isRepositoryError,
} from "../errors.js";
import { asChanges, asIso, asNumber } from "../normalize.js";

const USER_COLUMNS =
  "id, email, role, display_name, password_hash, session_version, failed_attempts, locked_until, created_at, email_verified, status, email_token, email_token_exp";

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    displayName: row.display_name ?? null,
    passwordHash: row.password_hash,
    sessionVersion: asNumber(row.session_version, 1),
    failedAttempts: asNumber(row.failed_attempts, 0),
    lockedUntil: asIso(row.locked_until),
    createdAt: asIso(row.created_at),
    emailVerified: row.email_verified !== undefined ? asNumber(row.email_verified, 0) : 0,
    status: row.status || (row.role === "admin" ? "ACTIVE" : "PENDING_APPROVAL"),
    emailToken: row.email_token || null,
    emailTokenExp: asIso(row.email_token_exp),
  };
}

function classifyWriteError(error) {
  if (isRepositoryError(error)) return error;
  const message = String(error?.message || "");
  if (/UNIQUE constraint failed/i.test(message)) {
    return new RepositoryError("A user with these details already exists.", {
      code: REPOSITORY_ERROR_CODES.CONFLICT,
      cause: error,
    });
  }
  if (/constraint failed/i.test(message)) {
    return new RepositoryError("The user write violated a database constraint.", {
      code: REPOSITORY_ERROR_CODES.CONSTRAINT,
      cause: error,
    });
  }
  return new RepositoryError("User storage is unavailable.", {
    code: REPOSITORY_ERROR_CODES.UNAVAILABLE,
    cause: error,
    retryable: true,
  });
}

export function createSqliteUsersRepository(db) {
  if (
    !db ||
    typeof db.get !== "function" ||
    typeof db.run !== "function" ||
    typeof db.transaction !== "function"
  ) {
    throw new TypeError("createSqliteUsersRepository requires a query API.");
  }

  async function findById(id) {
    if (!id) return null;
    return toUser(await db.get(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]));
  }

  async function findSessionIdentity(id) {
    if (!id) return null;
    const row = await db.get(
      "SELECT id, email, role, session_version FROM users WHERE id = ?",
      [id],
    );
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      sessionVersion: asNumber(row.session_version, 1),
    };
  }

  // Emails are stored lowercased by the account layer, so lookups match exactly.
  async function findAuthByEmail(email) {
    if (!email) return null;
    return toUser(
      await db.get(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`, [email]),
    );
  }

  async function findIdByEmail(email) {
    if (!email) return null;
    const row = await db.get("SELECT id FROM users WHERE email = ?", [email]);
    return row ? row.id : null;
  }

  async function create({
    id,
    email,
    passwordHash,
    role = "student",
    displayName = null,
    sessionVersion = 1,
    emailVerified = 0,
    status = "PENDING_APPROVAL",
    emailToken = null,
    emailTokenExp = null,
    createdAt,
    updatedAt,
  } = {}) {
    if (!id || !email || !passwordHash || !createdAt || !updatedAt) {
      throw new RepositoryError(
        "id, email, passwordHash, createdAt and updatedAt are required.",
        { code: REPOSITORY_ERROR_CODES.INVALID_STATE },
      );
    }
    try {
      await db.run(
        `INSERT INTO users
          (id, email, password_hash, role, display_name, session_version, failed_attempts, locked_until, created_at, updated_at, email_verified, status, email_token, email_token_exp)
         VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          email,
          passwordHash,
          role,
          displayName,
          asNumber(sessionVersion, 1),
          createdAt,
          updatedAt,
          asNumber(emailVerified, 0),
          status,
          emailToken,
          emailTokenExp,
        ],
      );
    } catch (error) {
      throw classifyWriteError(error);
    }
    return findById(id);
  }

  async function findByEmailToken(token) {
    if (!token) return null;
    return toUser(
      await db.get(`SELECT ${USER_COLUMNS} FROM users WHERE email_token = ?`, [token]),
    );
  }

  async function verifyEmailToken(token, nowIsoStr) {
    if (!token) return null;
    return await db.transaction((tx) => {
      const row = tx.get(
        `SELECT id, email_token_exp FROM users WHERE email_token = ?`,
        [token],
      );
      if (!row) return { ok: false, reason: "NOT_FOUND" };
      if (row.email_token_exp && new Date(row.email_token_exp).getTime() < Date.now()) {
        return { ok: false, reason: "EXPIRED" };
      }
      tx.run(
        `UPDATE users SET email_verified = 1, email_token = NULL, email_token_exp = NULL, updated_at = ? WHERE id = ?`,
        [nowIsoStr, row.id],
      );
      return { ok: true, userId: row.id };
    });
  }

  async function updateStatus(id, newStatus, updatedAt) {
    if (!id || !newStatus) return 0;
    try {
      const result = await db.run(
        `UPDATE users SET status = ?, updated_at = ? WHERE id = ?`,
        [newStatus, updatedAt, id],
      );
      return asChanges(result);
    } catch (error) {
      throw classifyWriteError(error);
    }
  }

  async function updateEmailToken(id, token, expiresAt, updatedAt) {
    if (!id) return 0;
    try {
      const result = await db.run(
        `UPDATE users SET email_token = ?, email_token_exp = ?, updated_at = ? WHERE id = ?`,
        [token, expiresAt, updatedAt, id],
      );
      return asChanges(result);
    } catch (error) {
      throw classifyWriteError(error);
    }
  }

  async function listPendingUsers() {
    const rows = await db.all(
      `SELECT id, email, role, display_name, email_verified, status, created_at FROM users WHERE status = 'PENDING_APPROVAL' ORDER BY created_at ASC`,
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      displayName: r.display_name ?? null,
      emailVerified: asNumber(r.email_verified, 0),
      status: r.status,
      createdAt: asIso(r.created_at),
    }));
  }

  async function recordFailedLogin(id, { failedAttempts, lockedUntil = null, updatedAt } = {}) {
    if (!id) return 0;
    try {
      const result = await db.run(
        "UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?",
        [asNumber(failedAttempts, 0), lockedUntil, updatedAt, id],
      );
      return asChanges(result);
    } catch (error) {
      throw classifyWriteError(error);
    }
  }

  async function resetFailedLogins(id) {
    if (!id) return 0;
    try {
      const result = await db.run(
        "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?",
        [id],
      );
      return asChanges(result);
    } catch (error) {
      throw classifyWriteError(error);
    }
  }

  async function updatePassword(id, passwordHash, updatedAt) {
    if (!id || !passwordHash) {
      throw new RepositoryError("id and passwordHash are required.", {
        code: REPOSITORY_ERROR_CODES.INVALID_STATE,
      });
    }
    try {
      const result = await db.run(
        "UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?",
        [passwordHash, updatedAt, id],
      );
      return asChanges(result);
    } catch (error) {
      throw classifyWriteError(error);
    }
  }

  async function deleteWithAuditDetach(id) {
    if (!id) return 0;
    try {
      // The audit trail survives the delete, detached from the identity.
      return await db.transaction((tx) => {
        tx.run("UPDATE audit_log SET user_id = NULL WHERE user_id = ?", [id]);
        const result = tx.run("DELETE FROM users WHERE id = ?", [id]);
        return asChanges(result);
      });
    } catch (error) {
      throw classifyWriteError(error);
    }
  }

  return Object.freeze({
    findById,
    findSessionIdentity,
    findAuthByEmail,
    findIdByEmail,
    findByEmailToken,
    verifyEmailToken,
    updateStatus,
    updateEmailToken,
    listPendingUsers,
    create,
    recordFailedLogin,
    resetFailedLogins,
    updatePassword,
    deleteWithAuditDetach,
  });
}
