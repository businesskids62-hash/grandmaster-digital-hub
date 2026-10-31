import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../lib/db/migrations.js";
import { createQueryApi } from "../lib/db/sqliteAdapter.js";
import { createRepositories, repositoriesFor } from "../lib/data/index.js";
import { RepositoryError, isRepositoryError } from "../lib/data/errors.js";
import { asChanges, asIso, asNumber } from "../lib/data/normalize.js";
import { createSqliteUsersRepository } from "../lib/data/sqlite/users.js";

const engine = new DatabaseSync(":memory:");
engine.exec("PRAGMA foreign_keys = ON;");
const api = createQueryApi(engine, {
  initialize: async (sync) => {
    await migrate(sync);
  },
});
const users = createSqliteUsersRepository(api);

const HASH = "$2b$04$0123456789012345678901234567890123456789012345678901";
const STAMP = "2026-10-30T08:00:00.000Z";

after(async () => {
  await api.close();
});

let sequence = 0;
function nextEmail(label = "user") {
  sequence += 1;
  return `${label}.${sequence}@example.com`;
}

async function makeUser(overrides = {}) {
  return await users.create({
    id: randomUUID(),
    email: nextEmail(),
    passwordHash: HASH,
    role: "student",
    displayName: "Learner",
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  });
}

test("create then findById returns a camelCase user record", async () => {
  const email = nextEmail("create");
  const created = await makeUser({ email });
  assert.equal(created.email, email);
  assert.equal(created.role, "student");
  assert.equal(created.displayName, "Learner");
  assert.equal(created.passwordHash, HASH);
  assert.equal(created.sessionVersion, 1);
  assert.equal(created.failedAttempts, 0);
  assert.equal(created.lockedUntil, null);
  assert.equal(created.createdAt, STAMP);
  assert.equal("password_hash" in created, false);
  assert.equal("display_name" in created, false);

  assert.deepEqual(await users.findById(created.id), created);
  assert.equal(await users.findById(randomUUID()), null);
});

test("duplicate email raises a CONFLICT repository error", async () => {
  const email = nextEmail("duplicate");
  await makeUser({ email });
  await assert.rejects(
    () => makeUser({ email }),
    (error) => error instanceof RepositoryError && error.code === "CONFLICT",
  );
});

test("findAuthByEmail returns the hash and lock state", async () => {
  const email = nextEmail("auth");
  const created = await makeUser({ email, displayName: "Auth User" });
  const auth = await users.findAuthByEmail(email);
  assert.equal(auth.id, created.id);
  assert.equal(auth.passwordHash, HASH);
  assert.equal(auth.displayName, "Auth User");
  assert.equal(auth.failedAttempts, 0);
  assert.equal(auth.lockedUntil, null);
  assert.equal(await users.findAuthByEmail(nextEmail("missing")), null);
});

test("findSessionIdentity omits the password hash", async () => {
  const created = await makeUser();
  const identity = await users.findSessionIdentity(created.id);
  assert.deepEqual(identity, {
    id: created.id,
    email: created.email,
    role: "student",
    sessionVersion: 1,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(identity, "passwordHash"), false);
  assert.equal(await users.findSessionIdentity(randomUUID()), null);
});

test("findIdByEmail returns the matching id", async () => {
  const created = await makeUser();
  assert.equal(await users.findIdByEmail(created.email), created.id);
  assert.equal(await users.findIdByEmail(nextEmail("unknown")), null);
});

test("recordFailedLogin and resetFailedLogins persist lock state", async () => {
  const created = await makeUser();
  const lockedUntil = "2026-10-30T08:05:00.000Z";

  assert.equal(
    await users.recordFailedLogin(created.id, {
      failedAttempts: 3,
      lockedUntil: null,
      updatedAt: STAMP,
    }),
    1,
  );
  let row = await api.get(
    "SELECT failed_attempts, locked_until FROM users WHERE id = ?",
    [created.id],
  );
  assert.equal(row.failed_attempts, 3);
  assert.equal(row.locked_until, null);

  assert.equal(
    await users.recordFailedLogin(created.id, {
      failedAttempts: 5,
      lockedUntil,
      updatedAt: STAMP,
    }),
    1,
  );
  row = await api.get("SELECT failed_attempts, locked_until FROM users WHERE id = ?", [
    created.id,
  ]);
  assert.equal(row.failed_attempts, 5);
  assert.equal(row.locked_until, lockedUntil);
  assert.equal((await users.findById(created.id)).lockedUntil, lockedUntil);

  assert.equal(await users.resetFailedLogins(created.id), 1);
  row = await api.get("SELECT failed_attempts, locked_until FROM users WHERE id = ?", [
    created.id,
  ]);
  assert.equal(row.failed_attempts, 0);
  assert.equal(row.locked_until, null);
});

test("updatePassword replaces the hash and bumps the session version", async () => {
  const created = await makeUser();
  const newHash = "$2b$04$abcdefghijklmnopqrstuvwxyz01234567890123456789012345678901";
  const later = "2026-10-30T09:00:00.000Z";

  assert.equal(await users.updatePassword(created.id, newHash, later), 1);
  const updated = await users.findById(created.id);
  assert.equal(updated.passwordHash, newHash);
  assert.equal(updated.sessionVersion, 2);
  assert.equal(updated.createdAt, STAMP);
});

test("deleteWithAuditDetach removes dependent rows and detaches the audit trail", async () => {
  const created = await makeUser();
  await api.run(
    "INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
    [
      randomUUID(),
      created.id,
      randomUUID().replace(/-/g, ""),
      "2026-10-30T09:00:00.000Z",
      STAMP,
    ],
  );
  await api.run("INSERT INTO login_events (id, user_id) VALUES (?, ?)", [
    randomUUID(),
    created.id,
  ]);
  const auditId = randomUUID();
  await api.run(
    "INSERT INTO audit_log (id, user_id, action, detail, created_at) VALUES (?, ?, 'signup', NULL, ?)",
    [auditId, created.id, STAMP],
  );

  assert.equal(await users.deleteWithAuditDetach(created.id), 1);
  assert.equal(await users.findById(created.id), null);
  assert.equal(
    Number(
      (await api.get("SELECT COUNT(*) AS c FROM password_resets WHERE user_id = ?", [created.id]))
        .c,
    ),
    0,
  );
  assert.equal(
    Number(
      (await api.get("SELECT COUNT(*) AS c FROM login_events WHERE user_id = ?", [created.id])).c,
    ),
    0,
  );
  const audit = await api.get("SELECT user_id FROM audit_log WHERE id = ?", [auditId]);
  assert.equal(audit.user_id, null);
});

test("a failing delete rolls the audit detach back", async () => {
  const created = await makeUser();
  const auditId = randomUUID();
  await api.run(
    "INSERT INTO audit_log (id, user_id, action, detail, created_at) VALUES (?, ?, 'login', NULL, ?)",
    [auditId, created.id, STAMP],
  );

  await api.exec(
    "CREATE TRIGGER block_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'delete blocked'); END;",
  );
  try {
    await assert.rejects(
      () => users.deleteWithAuditDetach(created.id),
      (error) => isRepositoryError(error) && error.code === "UNAVAILABLE",
    );
  } finally {
    await api.exec("DROP TRIGGER block_user_delete;");
  }

  assert.ok(await users.findById(created.id));
  const audit = await api.get("SELECT user_id FROM audit_log WHERE id = ?", [auditId]);
  assert.equal(audit.user_id, created.id);
});

test("repositoriesFor caches one frozen repository set per handle", () => {
  const first = repositoriesFor(api);
  assert.equal(repositoriesFor(api), first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(typeof first.users.findById, "function");
  assert.equal(typeof first.users.deleteWithAuditDetach, "function");

  const custom = createRepositories({
    get: async () => null,
    run: async () => ({ changes: 0 }),
    transaction: async () => 0,
  });
  assert.notEqual(custom, first);
  assert.equal(Object.isFrozen(custom), true);
  assert.throws(() => repositoriesFor(null), TypeError);
});

test("normalize helpers convert dates and counts consistently", () => {
  assert.equal(asIso("2026-10-30 08:00:00"), "2026-10-30T08:00:00.000Z");
  assert.equal(asIso("2026-10-30"), "2026-10-30T00:00:00.000Z");
  assert.equal(asIso("2026-10-30T08:00:00.000Z"), "2026-10-30T08:00:00.000Z");
  assert.equal(asIso(null), null);
  assert.equal(asIso("not-a-date"), null);
  assert.equal(asNumber("3", 0), 3);
  assert.equal(asNumber(undefined, 7), 7);
  assert.equal(asChanges({ changes: 2 }), 2);
  assert.equal(asChanges(undefined), 0);
});
