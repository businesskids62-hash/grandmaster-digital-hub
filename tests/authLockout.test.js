import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-lockout-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.BCRYPT_ROUNDS = "4";
process.env.GRANDMASTER_LOG_SILENT = "1";
delete process.env.GRANDMASTER_DB_PATH;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

const { closeDatabase, getDatabase } = await import("../lib/db/index.js");
const { authenticateUser, signupUser } = await import("../lib/auth/accounts.js");

const PASSWORD = "CorrectHorseBattery1";
const WRONG = "wrong-password-1";

after(async () => {
  await closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function createAccount(email) {
  const result = await signupUser(
    { email, password: PASSWORD, displayName: "Lockout" },
    process.env,
  );
  assert.equal(result.ok, true);
  return getDatabase(process.env);
}

async function lockState(db, email) {
  return db.get(
    "SELECT failed_attempts, locked_until FROM users WHERE email = ?",
    [email],
  );
}

test("five concurrent failed logins lock the account", async () => {
  const email = "concurrent@example.test";
  const db = await createAccount(email);

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      authenticateUser({ email, password: WRONG }, process.env),
    ),
  );
  for (const result of results) {
    assert.equal(result.status, 401);
    assert.equal(result.code, "AUTH_INVALID_CREDENTIALS");
  }

  const state = await lockState(db, email);
  assert.equal(state.failed_attempts, 5);
  assert.ok(state.locked_until);

  const blocked = await authenticateUser(
    { email, password: PASSWORD },
    process.env,
  );
  assert.equal(blocked.status, 429);
  assert.equal(blocked.code, "AUTH_LOCKED");
  assert.ok(blocked.retryAfter > 0);
});

test("concurrent failures below the threshold stay unlocked", async () => {
  const email = "burst4@example.test";
  const db = await createAccount(email);

  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      authenticateUser({ email, password: WRONG }, process.env),
    ),
  );
  for (const result of results) assert.equal(result.code, "AUTH_INVALID_CREDENTIALS");

  const state = await lockState(db, email);
  assert.equal(state.failed_attempts, 4);
  assert.equal(state.locked_until, null);

  const fifth = await authenticateUser(
    { email, password: WRONG },
    process.env,
  );
  assert.equal(fifth.status, 401);

  const blocked = await authenticateUser(
    { email, password: PASSWORD },
    process.env,
  );
  assert.equal(blocked.code, "AUTH_LOCKED");
});

test("sequential five-attempt lockout is unchanged", async () => {
  const email = "sequential@example.test";
  const db = await createAccount(email);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await authenticateUser(
      { email, password: WRONG },
      process.env,
    );
    assert.equal(result.status, 401);
    assert.equal(result.code, "AUTH_INVALID_CREDENTIALS");
  }

  const state = await lockState(db, email);
  assert.equal(state.failed_attempts, 5);
  assert.ok(state.locked_until);

  const blocked = await authenticateUser(
    { email, password: PASSWORD },
    process.env,
  );
  assert.equal(blocked.status, 429);
  assert.equal(blocked.code, "AUTH_LOCKED");
});
