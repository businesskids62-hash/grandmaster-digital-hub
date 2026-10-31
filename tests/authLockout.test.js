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

// Expected values are derived from lib/auth/accounts.js, not assumed:
// MAX_FAILED_ATTEMPTS = 5, BASE_LOCK_MS = 5 min, MAX_LOCK_MS = 30 min,
// lockMs(failures) = min(30 min, 5 min * 2 ** min(failures - 5, 4)).
// That is 5 → 300 s, 6 → 600 s, 7 → 1200 s, 8 → 2400 s capped to 1800 s,
// 9 → 4800 s capped to 1800 s.
const T0 = 1_800_000_000_000;
const at = (seconds) => T0 + seconds * 1000;

function lockSeconds(state, now) {
  return Math.round((new Date(state.locked_until).getTime() - now) / 1000);
}

test("lockout escalates 5 → 10 → 20 minutes and then holds the 30 minute cap", async () => {
  const email = "escalation@example.test";
  const db = await createAccount(email);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(
      (await authenticateUser({ email, password: WRONG }, process.env, at(0)))
        .status,
      401,
    );
  }

  const first = await lockState(db, email);
  assert.equal(first.failed_attempts, 5);
  assert.equal(lockSeconds(first, at(0)), 300);
  assert.equal(
    (await authenticateUser({ email, password: PASSWORD }, process.env, at(1)))
      .retryAfter,
    299,
  );

  // Second episode: the sixth failure only arrives after the first lock expired.
  assert.equal(
    (await authenticateUser({ email, password: WRONG }, process.env, at(301)))
      .status,
    401,
  );
  const second = await lockState(db, email);
  assert.equal(second.failed_attempts, 6);
  assert.equal(lockSeconds(second, at(301)), 600);

  assert.equal(
    (await authenticateUser({ email, password: WRONG }, process.env, at(902)))
      .status,
    401,
  );
  const third = await lockState(db, email);
  assert.equal(third.failed_attempts, 7);
  assert.equal(lockSeconds(third, at(902)), 1200);

  assert.equal(
    (await authenticateUser({ email, password: WRONG }, process.env, at(2103)))
      .status,
    401,
  );
  const fourth = await lockState(db, email);
  assert.equal(fourth.failed_attempts, 8);
  assert.equal(lockSeconds(fourth, at(2103)), 1800, "2400 s must clamp to the cap");

  assert.equal(
    (await authenticateUser({ email, password: WRONG }, process.env, at(3904)))
      .status,
    401,
  );
  const fifth = await lockState(db, email);
  assert.equal(fifth.failed_attempts, 9);
  assert.equal(lockSeconds(fifth, at(3904)), 1800, "cap must not grow further");
});

test("a successful login resets the counter and escalation restarts at the base lock", async () => {
  const email = "restart@example.test";
  const db = await createAccount(email);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await authenticateUser({ email, password: WRONG }, process.env, at(0));
  }
  assert.equal(
    (await authenticateUser({ email, password: WRONG }, process.env, at(301)))
      .status,
    401,
  );
  const escalated = await lockState(db, email);
  assert.equal(escalated.failed_attempts, 6);
  assert.equal(lockSeconds(escalated, at(301)), 600);

  const signedIn = await authenticateUser(
    { email, password: PASSWORD },
    process.env,
    at(10_000),
  );
  assert.equal(signedIn.ok, true);
  const cleared = await lockState(db, email);
  assert.equal(cleared.failed_attempts, 0);
  assert.equal(cleared.locked_until, null);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await authenticateUser({ email, password: WRONG }, process.env, at(10_001));
  }
  const reset = await lockState(db, email);
  assert.equal(reset.failed_attempts, 5);
  assert.equal(lockSeconds(reset, at(10_001)), 300, "must restart from the base lock");
});

test("failed attempts never decay with time alone", async () => {
  const email = "no-decay@example.test";
  const db = await createAccount(email);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await authenticateUser({ email, password: WRONG }, process.env, at(0));
  }

  // Far beyond the 300 s lock: the counter must still be cumulative, so the
  // next failure escalates to 10 minutes instead of restarting the ladder.
  assert.equal(
    (await authenticateUser({ email, password: WRONG }, process.env, at(50_000)))
      .status,
    401,
  );
  const persisted = await lockState(db, email);
  assert.equal(persisted.failed_attempts, 6);
  assert.equal(lockSeconds(persisted, at(50_000)), 600);
});
