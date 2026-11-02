import { randomUUID } from "node:crypto";
import { REPOSITORY_ERROR_CODES } from "../data/errors.js";
import { repositoriesFor } from "../data/index.js";
import { writeAudit } from "./audit.js";
import { emailProblem, normalizeEmail } from "./accounts.js";
import { hashPassword, passwordProblem } from "./passwords.js";

/**
 * The only path that can create an admin or rewrite an admin password.
 *
 * It is reached exclusively from `scripts/bootstrap-admin.mjs`: no HTTP route,
 * no request handler and no startup seed imports this module, so the public
 * surface can never mint an admin.
 *
 * All reads and writes go through the users repository seam, never hand-written
 * SQL, and every result is a fixed code string. No value that came from a
 * credential, a database error or the filesystem is ever returned or logged.
 */

export const ADMIN_BOOTSTRAP_CODES = Object.freeze({
  CREATED: "ADMIN_CREATED",
  ALREADY_PROVISIONED: "ADMIN_ALREADY_PROVISIONED",
  RESET: "ADMIN_PASSWORD_RESET",
  INVALID_EMAIL: "BOOTSTRAP_EMAIL_INVALID",
  WEAK_PASSWORD: "BOOTSTRAP_WEAK_PASSWORD",
  NOT_ADMIN: "BOOTSTRAP_NOT_ADMIN",
  NOT_FOUND: "BOOTSTRAP_ADMIN_NOT_FOUND",
  INVALID_ARGUMENT: "BOOTSTRAP_CONFIG_INVALID",
  UNAVAILABLE: "BOOTSTRAP_STORAGE_UNAVAILABLE",
});

export const ADMIN_BOOTSTRAP_ACTIONS = Object.freeze({
  PROVISION: "admin_provisioned",
  RESET: "admin_password_reset",
});

const AUDIT_DETAIL = Object.freeze({ reason: "operator_cli", role: "admin" });

function nowIso() {
  return new Date().toISOString();
}

function refusal(code) {
  return { ok: false, code, userId: null };
}

function checkArguments({ email, password, env }) {
  if (!env || typeof env !== "object") return ADMIN_BOOTSTRAP_CODES.INVALID_ARGUMENT;
  const normalized = normalizeEmail(email);
  if (!normalized || emailProblem(normalized)) return ADMIN_BOOTSTRAP_CODES.INVALID_EMAIL;
  if (typeof password !== "string" || !password) {
    return ADMIN_BOOTSTRAP_CODES.INVALID_ARGUMENT;
  }
  if (passwordProblem(password)) return ADMIN_BOOTSTRAP_CODES.WEAK_PASSWORD;
  return null;
}

async function readByEmail(users, email) {
  try {
    return { user: await users.findAuthByEmail(email) };
  } catch {
    return { error: true };
  }
}

/**
 * Creates the admin row for the password the operator CLI resolved, or reports
 * the row that is already there. Idempotent and write-free when an admin already
 * exists: the stored hash, `session_version` and `updated_at` are never touched
 * here.
 *
 * An email that belongs to a learner is refused instead of promoted.
 */
export async function provisionAdmin(db, { email, password, env = process.env } = {}) {
  const invalid = checkArguments({ email, password, env });
  if (invalid) return refusal(invalid);

  const normalized = normalizeEmail(email);
  const users = repositoriesFor(db).users;
  const existing = await readByEmail(users, normalized);
  if (existing.error) return refusal(ADMIN_BOOTSTRAP_CODES.UNAVAILABLE);

  if (existing.user) {
    if (existing.user.role !== "admin") return refusal(ADMIN_BOOTSTRAP_CODES.NOT_ADMIN);
    return {
      ok: true,
      code: ADMIN_BOOTSTRAP_CODES.ALREADY_PROVISIONED,
      userId: existing.user.id,
      sessionVersion: existing.user.sessionVersion,
    };
  }

  const id = randomUUID();
  const stamp = nowIso();
  let created = null;
  try {
    created = await users.create({
      id,
      email: normalized,
      passwordHash: hashPassword(password, env),
      role: "admin",
      displayName: null,
      sessionVersion: 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
  } catch (error) {
    // The unique email index is the arbiter for a concurrent bootstrap. Losing
    // that race is the same outcome as running twice: report, never re-write.
    if (error?.code === REPOSITORY_ERROR_CODES.CONFLICT) {
      const rival = await readByEmail(users, normalized);
      if (rival.error) return refusal(ADMIN_BOOTSTRAP_CODES.UNAVAILABLE);
      if (rival.user?.role !== "admin") return refusal(ADMIN_BOOTSTRAP_CODES.NOT_ADMIN);
      return {
        ok: true,
        code: ADMIN_BOOTSTRAP_CODES.ALREADY_PROVISIONED,
        userId: rival.user.id,
        sessionVersion: rival.user.sessionVersion,
      };
    }
    return refusal(ADMIN_BOOTSTRAP_CODES.UNAVAILABLE);
  }

  const userId = created?.id || id;
  await writeAudit(db, {
    userId,
    action: ADMIN_BOOTSTRAP_ACTIONS.PROVISION,
    detail: AUDIT_DETAIL,
  });
  return {
    ok: true,
    code: ADMIN_BOOTSTRAP_CODES.CREATED,
    userId,
    sessionVersion: created?.sessionVersion ?? 1,
  };
}

/**
 * Deliberate admin password change. This is the only place in the codebase that
 * may rewrite an admin `password_hash`, and it bumps `session_version` on
 * purpose so every issued session dies.
 */
export async function resetAdminPassword(
  db,
  { email, password, env = process.env } = {},
) {
  const invalid = checkArguments({ email, password, env });
  if (invalid) return refusal(invalid);

  const normalized = normalizeEmail(email);
  const users = repositoriesFor(db).users;
  const existing = await readByEmail(users, normalized);
  if (existing.error) return refusal(ADMIN_BOOTSTRAP_CODES.UNAVAILABLE);
  if (!existing.user) return refusal(ADMIN_BOOTSTRAP_CODES.NOT_FOUND);
  if (existing.user.role !== "admin") return refusal(ADMIN_BOOTSTRAP_CODES.NOT_ADMIN);

  try {
    await users.updatePassword(existing.user.id, hashPassword(password, env), nowIso());
  } catch {
    return refusal(ADMIN_BOOTSTRAP_CODES.UNAVAILABLE);
  }

  await writeAudit(db, {
    userId: existing.user.id,
    action: ADMIN_BOOTSTRAP_ACTIONS.RESET,
    detail: AUDIT_DETAIL,
  });
  return {
    ok: true,
    code: ADMIN_BOOTSTRAP_CODES.RESET,
    userId: existing.user.id,
    sessionVersion: existing.user.sessionVersion + 1,
  };
}
