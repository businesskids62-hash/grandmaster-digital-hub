import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-bootstrap-"));
const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "scripts", "bootstrap-admin.mjs");

process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_SESSION_SECRET = "bootstrap-session-secret-0123456789abcdef0123456789";
process.env.ADMIN_EMAIL = "owner@example.com";
process.env.ADMIN_PASSWORD = "owner-password-123";
process.env.GRANDMASTER_UI_PASSWORD = "legacy-owner-password-123";
process.env.AUTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.BCRYPT_ROUNDS = "4";
process.env.GRANDMASTER_LOG_SILENT = "1";
delete process.env.GRANDMASTER_DB_PATH;
delete process.env.VERCEL;
delete process.env.NODE_ENV;

const { getDatabase, closeDatabase, resetDatabaseForTests } = await import("../lib/db/index.js");
const { SEED_IDS, seedDatabase } = await import("../lib/db/seed.js");
const {
  ADMIN_BOOTSTRAP_ACTIONS,
  ADMIN_BOOTSTRAP_CODES,
  provisionAdmin,
  resetAdminPassword,
} = await import("../lib/auth/adminBootstrap.js");
const { deleteUserAccount, signupUser } = await import("../lib/auth/accounts.js");
const { hashPassword, verifyPasswordHash } = await import("../lib/auth/passwords.js");
const { resolveSession, isAdmin } = await import("../lib/auth/guards.js");
const { SESSION_COOKIE_NAME, createSessionToken, createUserSessionToken } = await import(
  "../lib/auth/session.js"
);
const { handleLogin, resetAuthRateLimits } = await import("../lib/auth/routes.js");
const { run: runCliInProcess } = await import("../scripts/bootstrap-admin.mjs");

const ADMIN_EMAIL = "owner@example.com";
const ADMIN_SECRET = "bootstrap-secret-passphrase-1";
const ROTATED_SECRET = "rotated-secret-passphrase-2";
const PATH_LEAK = /[A-Za-z]:[\\/]|\/tmp\/|\/var\/task/;

// Every test gets its own scratch database, so nothing here can reach the
// repository's real data directory. Each file lives in its own sub-directory
// rather than directly in the data directory, because the guard counts creating
// a database inside a protected directory as a live write, and the directory the
// ambient configuration resolves to is protected.
function scratchCase(name) {
  const dir = path.join(dataDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function envFor(name) {
  return { ...process.env, GRANDMASTER_DB_PATH: path.join(scratchCase(name), "academy.db") };
}

async function openDb(name) {
  await resetDatabaseForTests();
  return getDatabase(envFor(name));
}

function adminRow(db) {
  return db.get("SELECT * FROM users WHERE role = 'admin'");
}

function adminCount(db) {
  return db.get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
}

function assertNoPathOrSecret(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.ok(!PATH_LEAK.test(text), `${label} must not contain a filesystem path`);
  assert.ok(!text.includes(dataDir), `${label} must not contain the data directory`);
  assert.ok(!text.includes(ADMIN_SECRET), `${label} must not contain the admin password`);
  assert.ok(
    !text.includes(process.env.GRANDMASTER_SESSION_SECRET),
    `${label} must not contain the session secret`,
  );
}

async function runCli(args, envOverride = {}, runOptions = {}) {
  const result = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: runOptions.cwd || repoRoot,
    env: { ...process.env, NODE_NO_WARNINGS: "1", ...envOverride },
  }).catch((error) => ({
    code: typeof error?.code === "number" ? error.code : 1,
    stdout: String(error?.stdout || ""),
    stderr: String(error?.stderr || ""),
  }));
  return {
    code: result.code ?? 0,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

// A terminal that answers nothing: exactly what a CI run looks like, and the
// reason a live target cannot be confirmed there.
function deadStdin() {
  return { isTTY: false, setRawMode: undefined };
}

/**
 * Creates a real scratch database at a path this test declares to be protected,
 * through the CLI's own two-step live confirmation. Nothing here points at the
 * repository's live database; `protectedFile` is always under the scratch root.
 */
async function provisionScratchLive(protectedFile) {
  const stdout = stdoutRecorder();
  const exitCode = await runCliInProcess({
    argv: [
      "bootstrap",
      "--email",
      ADMIN_EMAIL,
      "--database",
      protectedFile,
      "--create-new",
      "--allow-live",
    ],
    env: {
      ...process.env,
      ADMIN_PASSWORD: ADMIN_SECRET,
      GRANDMASTER_DB_PATH: protectedFile,
      GRANDMASTER_DATA_DIR: path.dirname(protectedFile),
    },
    stdin: ttyStdin(["LIVE"]),
    stdout,
  });
  assert.equal(exitCode, 0, "the operator who typed LIVE gets the database");
  assert.equal(
    stdout.lines.join(""),
    "Type LIVE to write to the live database: LIVE\nTARGET=live\nRESULT=ADMIN_CREATED\n",
  );
  return stdout;
}

/**
 * Runs one filesystem experiment and hands back a record of every filesystem
 * call the CLI made, so a rule that promises not to touch the disk can be
 * measured instead of trusted.
 */
async function withFilesystemSpy(run) {
  const calls = [];
  const originals = {
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    mkdirSync: fs.mkdirSync,
    openSync: fs.openSync,
    readFileSync: fs.readFileSync,
    realpathNative: fs.realpathSync.native,
    linkSync: fs.linkSync,
    symlinkSync: fs.symlinkSync,
  };
  const track = (name, original) =>
    function tracked(...args) {
      calls.push(`${name}:${String(args[0])}`);
      return original.apply(fs, args);
    };
  fs.existsSync = track("existsSync", originals.existsSync);
  fs.statSync = track("statSync", originals.statSync);
  fs.mkdirSync = track("mkdirSync", originals.mkdirSync);
  fs.openSync = track("openSync", originals.openSync);
  fs.readFileSync = track("readFileSync", originals.readFileSync);
  fs.realpathSync.native = track("realpathSync.native", originals.realpathNative);
  fs.linkSync = track("linkSync", originals.linkSync);
  fs.symlinkSync = track("symlinkSync", originals.symlinkSync);
  try {
    return { result: await run(), calls, originals };
  } finally {
    fs.existsSync = originals.existsSync;
    fs.statSync = originals.statSync;
    fs.mkdirSync = originals.mkdirSync;
    fs.openSync = originals.openSync;
    fs.readFileSync = originals.readFileSync;
    fs.realpathSync.native = originals.realpathNative;
    fs.linkSync = originals.linkSync;
    fs.symlinkSync = originals.symlinkSync;
  }
}

// The CLI calls whatever the ambient configuration resolves to a live target.
// A scratch run must therefore not leave GRANDMASTER_DB_PATH pointing at the
// very file it passes with `--database`, or it would be asked to confirm.
function scratchEnv(overrides = {}) {
  return { GRANDMASTER_DB_PATH: "", ...overrides };
}

function sourceText(file) {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

function stdoutRecorder() {
  return { lines: [], write(text) { this.lines.push(String(text)); return true; } };
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * A terminal stand-in that answers the CLI's interactive prompts in order, one
 * line per prompt, the way an operator typing at a keyboard would.
 */
function ttyStdin(lines) {
  const stdin = new EventEmitter();
  const queue = [...lines];
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdin.resume = () => {
    const next = queue.shift();
    if (next === undefined) return;
    queueMicrotask(() => {
      for (const chunk of [next, "\r"]) stdin.emit("data", Buffer.from(chunk));
    });
  };
  return stdin;
}

function jsFilesUnder(dir) {
  const found = [];
  const entries = fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true });
  for (const entry of entries) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...jsFilesUnder(relative));
    else if (/\.m?js$/.test(entry.name)) found.push(relative);
  }
  return found;
}

after(async () => {
  await closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("AT-1 the controlled bootstrap creates exactly one admin with a bcrypt hash and an audit row", async () => {
  const env = envFor("at1");
  const db = await openDb("at1");
  const result = await provisionAdmin(db, {
    email: "  Owner@Example.COM  ",
    password: ADMIN_SECRET,
    env,
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, ADMIN_BOOTSTRAP_CODES.CREATED);
  assert.equal(result.sessionVersion, 1);

  const admins = await db.all("SELECT * FROM users WHERE role = 'admin'");
  assert.equal(admins.length, 1);
  assert.equal(admins[0].email, ADMIN_EMAIL, "the address is normalised before the write");
  assert.equal(admins[0].session_version, 1);
  assert.equal(admins[0].failed_attempts, 0);
  assert.equal(admins[0].locked_until, null);
  assert.match(admins[0].password_hash, /^\$2[aby]\$/);
  assert.notEqual(admins[0].password_hash, ADMIN_SECRET);
  assert.equal(verifyPasswordHash(ADMIN_SECRET, admins[0].password_hash), true);
  assert.equal((await db.all("SELECT id FROM users")).length, 1, "no other account is created");

  const audits = await db.all("SELECT * FROM audit_log WHERE action = ?", [
    ADMIN_BOOTSTRAP_ACTIONS.PROVISION,
  ]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].user_id, admins[0].id);
});

test("AT-2 repeating the bootstrap reports the existing admin and writes nothing", async () => {
  const env = envFor("at2");
  const db = await openDb("at2");
  await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env });
  const before = await db.get(
    "SELECT password_hash, session_version, updated_at, created_at FROM users WHERE email = ?",
    [ADMIN_EMAIL],
  );

  const second = await provisionAdmin(db, { email: ADMIN_EMAIL, password: ROTATED_SECRET, env });
  assert.equal(second.ok, true);
  assert.equal(second.code, ADMIN_BOOTSTRAP_CODES.ALREADY_PROVISIONED);

  const after = await db.get(
    "SELECT password_hash, session_version, updated_at, created_at FROM users WHERE email = ?",
    [ADMIN_EMAIL],
  );
  assert.deepEqual(after, before, "a second bootstrap is read-only");
  assert.equal(
    (await db.all("SELECT id FROM audit_log WHERE action = ?", [ADMIN_BOOTSTRAP_ACTIONS.PROVISION]))
      .length,
    1,
    "no audit row is written for a no-op",
  );
  assert.equal(verifyPasswordHash(ADMIN_SECRET, after.password_hash), true);
  assert.equal(verifyPasswordHash(ROTATED_SECRET, after.password_hash), false);
});

test("AT-3 a manually changed admin password survives a cold restart and a re-seed", async () => {
  const env = envFor("at3");
  const db = await openDb("at3");
  await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env });
  const reset = await resetAdminPassword(db, { email: ADMIN_EMAIL, password: ROTATED_SECRET, env });
  assert.equal(reset.ok, true);
  assert.equal(reset.code, ADMIN_BOOTSTRAP_CODES.RESET);
  const changed = await db.get("SELECT password_hash, session_version FROM users WHERE email = ?", [
    ADMIN_EMAIL,
  ]);

  const reopened = await openDb("at3");
  await reopened.ready();
  const afterRestart = await reopened.get(
    "SELECT password_hash, session_version FROM users WHERE email = ?",
    [ADMIN_EMAIL],
  );
  assert.deepEqual(afterRestart, changed, "startup seed performs no admin write");
  assert.equal((await adminCount(reopened)).c, 1);
});

test("AT-4 the password change still holds after two further cold restarts", async () => {
  const env = envFor("at4");
  const db = await openDb("at4");
  await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env });
  await resetAdminPassword(db, { email: ADMIN_EMAIL, password: ROTATED_SECRET, env });
  const baseline = await db.get(
    "SELECT password_hash, session_version, updated_at FROM users WHERE email = ?",
    [ADMIN_EMAIL],
  );

  for (let restart = 0; restart < 2; restart += 1) {
    const reopened = await openDb("at4");
    await reopened.ready();
    await seedDatabase(reopened);
    const current = await reopened.get(
      "SELECT password_hash, session_version, updated_at FROM users WHERE email = ?",
      [ADMIN_EMAIL],
    );
    assert.deepEqual(current, baseline, `restart ${restart + 1} changed the admin credential`);
  }
});

test("AT-5 a deleted admin is not recreated by startup, and its audit trail survives detached", async () => {
  const env = envFor("at5");
  const db = await openDb("at5");
  const created = await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env });
  const auditBefore = await db.all("SELECT id, user_id FROM audit_log WHERE user_id IS NOT NULL");
  assert.ok(auditBefore.length >= 1);

  const deleted = await deleteUserAccount(created.userId, ADMIN_SECRET, env);
  assert.equal(deleted.ok, true);

  const reopened = await openDb("at5");
  await reopened.ready();
  assert.equal((await adminCount(reopened)).c, 0, "boot must not resurrect an admin");
  assert.equal((await reopened.get("SELECT COUNT(*) AS c FROM users")).c, 0);

  const detached = await reopened.all("SELECT id, user_id FROM audit_log");
  assert.equal(detached.length, auditBefore.length, "audit rows are detached, never deleted");
  assert.equal(detached.filter((row) => row.user_id === null).length, auditBefore.length);
});

test("AT-6 the CLI refuses a missing or short password without touching the database", async () => {
  const missing = envFor("at6-missing");
  const missingFile = missing.GRANDMASTER_DB_PATH;
  // `--create-new` is granted here so the only thing standing between these runs
  // and a brand-new file is the credential check itself.
  const absent = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", missingFile, "--create-new"],
    scratchEnv({ ADMIN_PASSWORD: "" }),
  );
  assert.notEqual(absent.code, 0);
  assert.match(absent.stdout, /ERROR=BOOTSTRAP_PASSWORD_UNAVAILABLE/);
  assert.equal(fs.existsSync(missingFile), false, "a refusal must not create a database");

  const short = envFor("at6-short");
  const shortFile = short.GRANDMASTER_DB_PATH;
  const weak = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", shortFile, "--create-new"],
    scratchEnv({ ADMIN_PASSWORD: "short12" }),
  );
  assert.notEqual(weak.code, 0);
  assert.match(weak.stdout, /ERROR=BOOTSTRAP_WEAK_PASSWORD/);
  assert.equal(fs.existsSync(shortFile), false);

  // The legacy shared password is never substituted for a missing admin password.
  const trap = envFor("at6-trap");
  const trapFile = trap.GRANDMASTER_DB_PATH;
  const trapped = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", trapFile, "--create-new"],
    scratchEnv({
      ADMIN_PASSWORD: "",
      GRANDMASTER_UI_PASSWORD: "legacy-owner-password-123",
    }),
  );
  assert.notEqual(trapped.code, 0);
  assert.match(trapped.stdout, /ERROR=BOOTSTRAP_PASSWORD_UNAVAILABLE/);
  assert.equal(fs.existsSync(trapFile), false);
});

test("AT-7 (adapted) a configured ADMIN_EMAIL closes the legacy login on every surface", async () => {
  const env = envFor("at7");
  const db = await openDb("at7");
  assert.equal((await adminCount(db)).c, 0, "startup created no admin");

  // The plan's AT-7 expected the legacy shared password to keep working while
  // ADMIN_EMAIL is set with no admin row. The shipped rule is the opposite
  // (lib/auth/routes.js:151-155), so this pins the real, stronger behaviour:
  // the fallback closes as soon as ADMIN_EMAIL exists, before any admin row is
  // bootstrapped. Losing both credentials therefore locks the Hub out.
  resetAuthRateLimits();
  const legacy = await handleLogin({
    method: "POST",
    headers: {},
    body: { password: process.env.GRANDMASTER_UI_PASSWORD },
    env: { ...env, AUTH_RATE_LIMIT_PER_MINUTE: "1000" },
    clientKey: "at7-legacy",
    requestId: "at7-legacy",
  });
  assert.equal(legacy.status, 401);
  assert.equal(legacy.body.code, "AUTH_INVALID_CREDENTIALS");

  const withoutAdminEmail = await handleLogin({
    method: "POST",
    headers: {},
    body: { password: process.env.GRANDMASTER_UI_PASSWORD },
    env: { ...env, ADMIN_EMAIL: "", AUTH_RATE_LIMIT_PER_MINUTE: "1000" },
    clientKey: "at7-legacy-open",
    requestId: "at7-legacy-open",
  });
  assert.equal(withoutAdminEmail.status, 200, "the fallback is only open while ADMIN_EMAIL is unset");
  resetAuthRateLimits();
});

test("AT-8 five concurrent bootstraps for one email leave a single admin row and no rejection", async () => {
  const env = envFor("at8");
  const db = await openDb("at8");
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env }),
    ),
  );

  assert.equal(results.filter((result) => result.ok).length, 5);
  assert.equal(results.filter((result) => result.code === ADMIN_BOOTSTRAP_CODES.CREATED).length, 1);
  assert.equal(
    results.filter((result) => result.code === ADMIN_BOOTSTRAP_CODES.ALREADY_PROVISIONED).length,
    4,
  );
  assert.equal((await adminCount(db)).c, 1);
  assert.equal(
    (await db.all("SELECT id FROM audit_log WHERE action = ?", [ADMIN_BOOTSTRAP_ACTIONS.PROVISION]))
      .length,
    1,
  );
});

test("AT-9 only an explicit reset invalidates sessions; boot and bootstrap never do", async () => {
  const env = envFor("at9");
  const db = await openDb("at9");
  const created = await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env });
  const user = await db.get("SELECT id, session_version FROM users WHERE email = ?", [ADMIN_EMAIL]);
  const token = createUserSessionToken(
    { id: user.id, sessionVersion: user.session_version },
    env,
  );
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}` };
  const sessionBefore = await resolveSession(headers, env);
  assert.equal(sessionBefore.role, "admin");
  assert.equal(sessionBefore.userId, user.id);
  assert.equal(isAdmin(sessionBefore), true);

  // A repeat bootstrap is the case that used to kill every session at boot.
  await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env });
  assert.equal((await resolveSession(headers, env)).sessionVersion, user.session_version);

  const reset = await resetAdminPassword(db, { email: ADMIN_EMAIL, password: ROTATED_SECRET, env });
  assert.equal(reset.sessionVersion, user.session_version + 1);
  assert.equal(await resolveSession(headers, env), null, "the issued session is revoked");

  const restarted = await openDb("at9");
  await restarted.ready();
  assert.equal(
    (await restarted.get("SELECT session_version FROM users WHERE email = ?", [ADMIN_EMAIL]))
      .session_version,
    user.session_version + 1,
    "restart keeps the deliberate bump",
  );
  assert.equal(created.ok, true);
});

test("AT-10 only the CLI reaches the bootstrap module and the startup seed writes no credential", () => {
  const importers = [];
  for (const dir of ["lib", "api", "server"]) {
    if (!fs.existsSync(path.join(repoRoot, dir))) continue;
    for (const file of jsFilesUnder(dir)) {
      const source = sourceText(file);
      if (/from\s*["'][^"']*adminBootstrap/.test(source)) importers.push(file);
    }
  }
  assert.deepEqual(importers, [], "no runtime module may import the admin bootstrap");

  const cliSource = sourceText(path.posix.join("scripts", "bootstrap-admin.mjs"));
  assert.match(cliSource, /from\s*["'][^"']*adminBootstrap/);
  assert.match(cliSource, /provisionAdmin/);
  assert.match(cliSource, /resetAdminPassword/);

  const seedSource = sourceText(path.posix.join("lib", "db", "seed.js"));
  for (const forbidden of [
    "password_hash",
    "hashPassword",
    "ADMIN_PASSWORD",
    "seedAdmin",
    "INSERT INTO users",
  ]) {
    assert.ok(!seedSource.includes(forbidden), `the startup seed must not mention ${forbidden}`);
  }
});

test("AT-11 signup can never mint an admin even when the payload carries a role", async () => {
  const env = envFor("at11");
  const db = await openDb("at11");
  const result = await signupUser(
    { email: "sneaky@example.com", password: ADMIN_SECRET, role: "admin" },
    env,
  );
  assert.equal(result.ok, true);
  assert.equal(result.user.role, "student");
  const row = await db.get("SELECT role FROM users WHERE email = ?", ["sneaky@example.com"]);
  assert.equal(row.role, "student");
  assert.equal((await adminCount(db)).c, 0);
});

test("AT-12 the bootstrap audit rows carry no credential, email or token", async () => {
  const env = envFor("at12");
  const db = await openDb("at12");
  await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env });
  await resetAdminPassword(db, { email: ADMIN_EMAIL, password: ROTATED_SECRET, env });

  const rows = await db.all(
    "SELECT action, detail FROM audit_log WHERE action IN (?, ?)",
    [ADMIN_BOOTSTRAP_ACTIONS.PROVISION, ADMIN_BOOTSTRAP_ACTIONS.RESET],
  );
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const detail = JSON.parse(row.detail);
    assert.deepEqual(Object.keys(detail).sort(), ["reason", "role"]);
    assertNoPathOrSecret(row.detail, row.action);
    assert.ok(!row.detail.includes(ADMIN_EMAIL), "the admin address is never stored");
    assert.ok(!row.detail.includes(ROTATED_SECRET));
  }
});

test("AT-13 a legacy v1 session still resolves to admin with no database row", async () => {
  const env = envFor("at13");
  const db = await openDb("at13");
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM users")).c, 0);

  const token = createSessionToken(env);
  const session = await resolveSession({ cookie: `${SESSION_COOKIE_NAME}=${token}` }, env);
  assert.equal(session.role, "admin");
  assert.equal(session.userId, null);
  assert.equal(session.legacy, true);
  assert.equal(isAdmin(session), true);
});

test("AT-14 every bootstrap outcome is a code with no path and no secret", async () => {
  const env = envFor("at14");
  const db = await openDb("at14");
  const outcomes = [];

  outcomes.push(await provisionAdmin(db, { email: "not-an-email", password: ADMIN_SECRET, env }));
  outcomes.push(await provisionAdmin(db, { email: ADMIN_EMAIL, password: "short12", env }));
  outcomes.push(await provisionAdmin(db, { env }));
  outcomes.push(await provisionAdmin(db, { email: ADMIN_EMAIL, env }));
  outcomes.push(await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env: null }));
  outcomes.push(await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env }));
  outcomes.push(await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env }));
  outcomes.push(
    await resetAdminPassword(db, { email: "missing@example.com", password: ADMIN_SECRET, env }),
  );
  outcomes.push(await resetAdminPassword(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env }));

  assert.deepEqual(
    outcomes.map((outcome) => outcome.code),
    [
      ADMIN_BOOTSTRAP_CODES.INVALID_EMAIL,
      ADMIN_BOOTSTRAP_CODES.WEAK_PASSWORD,
      ADMIN_BOOTSTRAP_CODES.INVALID_EMAIL,
      ADMIN_BOOTSTRAP_CODES.INVALID_ARGUMENT,
      ADMIN_BOOTSTRAP_CODES.INVALID_ARGUMENT,
      ADMIN_BOOTSTRAP_CODES.CREATED,
      ADMIN_BOOTSTRAP_CODES.ALREADY_PROVISIONED,
      ADMIN_BOOTSTRAP_CODES.NOT_FOUND,
      ADMIN_BOOTSTRAP_CODES.RESET,
    ],
  );
  for (const outcome of outcomes) {
    assertNoPathOrSecret(outcome, outcome.code);
  }

  const student = await signupUser(
    { email: "learner.at14@example.com", password: ADMIN_SECRET },
    env,
  );
  assert.equal(student.ok, true);
  const refused = await provisionAdmin(db, {
    email: "learner.at14@example.com",
    password: ADMIN_SECRET,
    env,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, ADMIN_BOOTSTRAP_CODES.NOT_ADMIN);
  assertNoPathOrSecret(refused, refused.code);

  const cli = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", env.GRANDMASTER_DB_PATH],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(cli.code, 0);
  assert.equal(cli.stdout, "TARGET=custom\nRESULT=ADMIN_ALREADY_PROVISIONED\n");
  assert.equal(cli.stderr, "");
  assertNoPathOrSecret(`${cli.stdout}${cli.stderr}`, "cli output");
});

test("AT-15 content seeding survives, and startup creates no user row at all", async () => {
  const db = await openDb("at15");
  await db.ready();

  assert.equal((await db.get("SELECT COUNT(*) AS c FROM courses")).c, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM lessons")).c, 3);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM quizzes")).c, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM questions")).c, 5);
  assert.equal((await db.get("SELECT id FROM courses WHERE id = ?", [SEED_IDS.course])).id, SEED_IDS.course);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM users")).c, 0, "boot writes no credential");

  await seedDatabase(db);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM courses")).c, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM lessons")).c, 3);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM questions")).c, 5);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM users")).c, 0);
});

test("AT-16 changing ADMIN_PASSWORD and re-running the whole init leaves the stored hash alone", async () => {
  const env = envFor("at16");
  const db = await openDb("at16");
  await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env });
  const before = await db.get(
    "SELECT password_hash, session_version, updated_at FROM users WHERE email = ?",
    [ADMIN_EMAIL],
  );

  const drifted = { ...env, ADMIN_PASSWORD: ROTATED_SECRET };
  const reopened = await openDb("at16");
  await reopened.ready();
  await seedDatabase(reopened);
  const afterInit = await reopened.get(
    "SELECT password_hash, session_version, updated_at FROM users WHERE email = ?",
    [ADMIN_EMAIL],
  );
  assert.deepEqual(afterInit, before, "init must not re-hash with the drifted env password");

  const again = await provisionAdmin(reopened, {
    email: ADMIN_EMAIL,
    password: ROTATED_SECRET,
    env: drifted,
  });
  assert.equal(again.code, ADMIN_BOOTSTRAP_CODES.ALREADY_PROVISIONED);
  const stillUnchanged = await reopened.get(
    "SELECT password_hash, session_version FROM users WHERE email = ?",
    [ADMIN_EMAIL],
  );
  assert.equal(stillUnchanged.password_hash, before.password_hash);
  assert.equal(stillUnchanged.session_version, before.session_version);
  assert.equal(verifyPasswordHash(ADMIN_SECRET, afterInit.password_hash), true);
  assert.equal(verifyPasswordHash(ROTATED_SECRET, afterInit.password_hash), false);
});

test("AT-17 a learner email is refused instead of promoted, by helper and by CLI", async () => {
  const helperEnv = envFor("at17-helper");
  const db = await openDb("at17-helper");
  const student = await signupUser({ email: "learner@example.com", password: ADMIN_SECRET }, helperEnv);
  assert.equal(student.ok, true);
  const before = await db.get(
    "SELECT id, role, password_hash, session_version, updated_at FROM users WHERE email = ?",
    ["learner@example.com"],
  );

  const refused = await provisionAdmin(db, {
    email: "learner@example.com",
    password: ROTATED_SECRET,
    env: helperEnv,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, ADMIN_BOOTSTRAP_CODES.NOT_ADMIN);
  assert.equal(refused.userId, null);
  assert.deepEqual(
    await db.get("SELECT id, role, password_hash, session_version, updated_at FROM users WHERE email = ?", [
      "learner@example.com",
    ]),
    before,
    "the learner row is untouched",
  );
  assert.equal((await adminCount(db)).c, 0);
  assert.equal(
    (await db.all("SELECT id FROM audit_log WHERE action = ?", [ADMIN_BOOTSTRAP_ACTIONS.PROVISION]))
      .length,
    0,
  );

  const resetRefused = await resetAdminPassword(db, {
    email: "learner@example.com",
    password: ROTATED_SECRET,
    env: helperEnv,
  });
  assert.equal(resetRefused.code, ADMIN_BOOTSTRAP_CODES.NOT_ADMIN);

  const cliEnv = envFor("at17-cli");
  const cliDb = await openDb("at17-cli");
  assert.equal(
    (await signupUser({ email: "learner@example.com", password: ADMIN_SECRET }, cliEnv)).ok,
    true,
  );
  const cli = await runCli(
    ["bootstrap", "--email", "learner@example.com", "--database", cliEnv.GRANDMASTER_DB_PATH],
    scratchEnv({ ADMIN_PASSWORD: ROTATED_SECRET }),
  );
  assert.notEqual(cli.code, 0, "the CLI exits non-zero");
  assert.match(cli.stdout, /ERROR=BOOTSTRAP_NOT_ADMIN/);
  assert.equal((await cliDb.get("SELECT role FROM users WHERE email = ?", ["learner@example.com"])).role, "student");
});

test("C-06 the audit write is best effort: losing it does not roll back the credential", async () => {
  const env = envFor("c06");
  const db = await openDb("c06");
  await db.exec("DROP TABLE audit_log");

  const result = await provisionAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_SECRET, env });
  assert.equal(result.ok, true);
  assert.equal(result.code, ADMIN_BOOTSTRAP_CODES.CREATED);
  assert.equal((await adminCount(db)).c, 1, "the admin row is committed on its own");
});

test("E3 the CLI bootstraps, is idempotent, and rotates the password through explicit commands", async () => {
  const env = envFor("cli-happy");
  const file = env.GRANDMASTER_DB_PATH;

  const first = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", file, "--create-new"],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(first.code, 0);
  assert.equal(first.stdout, "TARGET=custom\nRESULT=ADMIN_CREATED\n");

  // The permission to create a file is not sticky: this second run is accepted
  // only because the database the first run wrote is really there.
  const second = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", file],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(second.code, 0);
  assert.equal(second.stdout, "TARGET=custom\nRESULT=ADMIN_ALREADY_PROVISIONED\n");

  const db = await openDb("cli-happy");
  const hashBefore = (await db.get("SELECT password_hash FROM users WHERE email = ?", [ADMIN_EMAIL]))
    .password_hash;

  const rotated = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL, "--database", file],
    scratchEnv({ ADMIN_PASSWORD: ROTATED_SECRET }),
  );
  assert.equal(rotated.code, 0);
  assert.equal(rotated.stdout, "TARGET=custom\nRESULT=ADMIN_PASSWORD_RESET\n");

  const after = await db.get(
    "SELECT password_hash, session_version FROM users WHERE email = ?",
    [ADMIN_EMAIL],
  );
  assert.notEqual(after.password_hash, hashBefore);
  assert.equal(verifyPasswordHash(ROTATED_SECRET, after.password_hash), true);
  assert.equal(verifyPasswordHash(ADMIN_SECRET, after.password_hash), false);
  assert.equal(after.session_version, 2);

  for (const output of [first, second, rotated]) {
    assertNoPathOrSecret(`${output.stdout}${output.stderr}`, "cli output");
    assert.ok(!output.stdout.includes(hashBefore), "the stored hash is never printed");
    assert.equal(output.stderr, "");
  }
});

test("E3 the CLI refuses a secret in argv, malformed usage, and an ephemeral or production host", async () => {
  const env = envFor("cli-refusals");
  const file = env.GRANDMASTER_DB_PATH;

  const inArgv = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", file, "--password", ADMIN_SECRET],
    { ADMIN_PASSWORD: "" },
  );
  assert.notEqual(inArgv.code, 0);
  assert.match(inArgv.stdout, /ERROR=BOOTSTRAP_SECRET_ARGUMENT_FORBIDDEN/);

  const glued = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", file, `--password=${ADMIN_SECRET}`],
    { ADMIN_PASSWORD: "" },
  );
  assert.notEqual(glued.code, 0);
  assert.match(glued.stdout, /ERROR=BOOTSTRAP_SECRET_ARGUMENT_FORBIDDEN/);

  const unknownCommand = await runCli(["promote-admin", "--database", file]);
  assert.notEqual(unknownCommand.code, 0);
  assert.match(unknownCommand.stdout, /ERROR=BOOTSTRAP_USAGE_INVALID/);

  const unknownFlag = await runCli(["bootstrap", "--force", "--database", file]);
  assert.notEqual(unknownFlag.code, 0);
  assert.match(unknownFlag.stdout, /ERROR=BOOTSTRAP_USAGE_INVALID/);

  const noEmail = await runCli(["bootstrap", "--database", file], scratchEnv({ ADMIN_EMAIL: "" }));
  assert.notEqual(noEmail.code, 0);
  assert.match(noEmail.stdout, /ERROR=BOOTSTRAP_USAGE_INVALID/);

  const serverless = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", file],
    scratchEnv({ VERCEL: "1", ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.notEqual(serverless.code, 0);
  assert.match(serverless.stdout, /ERROR=BOOTSTRAP_ENVIRONMENT_FORBIDDEN/);

  const production = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", file],
    scratchEnv({ NODE_ENV: "production", ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.notEqual(production.code, 0);
  assert.match(production.stdout, /ERROR=BOOTSTRAP_ENVIRONMENT_FORBIDDEN/);

  assert.equal(fs.existsSync(file), false, "every refusal happens before storage is opened");
  for (const output of [inArgv, glued, unknownCommand, unknownFlag, noEmail, serverless, production]) {
    assertNoPathOrSecret(`${output.stdout}${output.stderr}`, "cli refusal");
  }
});

test("E3 the CLI takes the password from the environment only when it is configured", async () => {
  const env = envFor("cli-env-source");
  const viaEnv = await runCli(
    ["bootstrap", "--database", env.GRANDMASTER_DB_PATH, "--create-new"],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(viaEnv.code, 0);
  assert.equal(viaEnv.stdout, "TARGET=custom\nRESULT=ADMIN_CREATED\n");

  const db = await openDb("cli-env-source");
  const row = await adminRow(db);
  assert.equal(row.email, ADMIN_EMAIL, "ADMIN_EMAIL is the default address");
  assert.equal(verifyPasswordHash(ADMIN_SECRET, row.password_hash), true);
  assert.equal(hashPassword(ADMIN_SECRET, env) === row.password_hash, false, "salts differ per call");
  assert.match(row.password_hash, /^\$2[aby]\$/);
  assertNoPathOrSecret(JSON.stringify(row), "stored admin row");
});

test("E3 the interactive prompt collects the password without echoing it", async () => {
  const env = envFor("cli-prompt");
  const typedSecret = "typed-secret-passphrase-9";
  const stdout = { lines: [], write(text) { this.lines.push(String(text)); return true; } };
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdin.resume = () => {
    queueMicrotask(() => {
      for (const chunk of [typedSecret, "\r"]) stdin.emit("data", Buffer.from(chunk));
    });
  };

  const exitCode = await runCliInProcess({
    argv: ["bootstrap", "--email", ADMIN_EMAIL, "--database", env.GRANDMASTER_DB_PATH, "--create-new"],
    env: { ...env, ADMIN_PASSWORD: "", GRANDMASTER_DB_PATH: "" },
    stdin,
    stdout,
  });

  assert.equal(exitCode, 0);
  assert.equal(
    stdout.lines.join(""),
    `ADMIN_PASSWORD: ${"*".repeat(typedSecret.length)}\nTARGET=custom\nRESULT=ADMIN_CREATED\n`,
  );

  const db = await openDb("cli-prompt");
  const row = await adminRow(db);
  assert.equal(verifyPasswordHash(typedSecret, row.password_hash), true);
});

test("E3 an aborted prompt (Ctrl-C) exits non-zero without writing anything", async () => {
  const env = envFor("cli-abort");
  const stdout = { lines: [], write(text) { this.lines.push(String(text)); return true; } };
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdin.resume = () => {
    queueMicrotask(() => stdin.emit("data", Buffer.from("partialX\b\u0003")));
  };

  const exitCode = await runCliInProcess({
    argv: [
      "bootstrap",
      "--email",
      ADMIN_EMAIL,
      "--database",
      env.GRANDMASTER_DB_PATH,
      "--create-new",
    ],
    env: { ...env, ADMIN_PASSWORD: "", GRANDMASTER_DB_PATH: "" },
    stdin,
    stdout,
  });

  assert.equal(exitCode, 1);
  assert.equal(
    stdout.lines.join(""),
    "ADMIN_PASSWORD: ********\b \b\nERROR=BOOTSTRAP_PASSWORD_UNAVAILABLE\n",
  );
  assert.ok(!stdout.lines.join("").includes("partial"), "the typed text is never echoed");
  assert.equal(fs.existsSync(env.GRANDMASTER_DB_PATH), false);
});

test("A1-1 the CLI refuses to guess which database it should write", async () => {
  const bootstrap = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(bootstrap.code, 1);
  assert.equal(bootstrap.stdout, "ERROR=BOOTSTRAP_TARGET_REQUIRED\n");
  assert.equal(bootstrap.stderr, "");

  const reset = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(reset.code, 1);
  assert.equal(reset.stdout, "ERROR=BOOTSTRAP_TARGET_REQUIRED\n");

  // No default target exists, so an omitted --database cannot have opened or
  // created the file the ambient configuration would have chosen.
  assert.equal(fs.existsSync(path.join(dataDir, "academy.db")), false);
});

test("A1-2 a live target is refused without --allow-live and without a typed confirmation", async () => {
  const env = envFor("a1-live-refused");
  const file = env.GRANDMASTER_DB_PATH;

  const noFlag = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", file],
    { ADMIN_PASSWORD: ADMIN_SECRET, GRANDMASTER_DB_PATH: file },
  );
  assert.equal(noFlag.code, 1);
  assert.equal(noFlag.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
  assert.equal(fs.existsSync(file), false, "a refused live target is never created");

  const flagOnly = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", file, "--allow-live"],
    { ADMIN_PASSWORD: ADMIN_SECRET, GRANDMASTER_DB_PATH: file },
  );
  assert.equal(flagOnly.code, 1);
  assert.equal(flagOnly.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
  assert.equal(fs.existsSync(file), false, "the flag alone is not a confirmation");

  const wrongWord = await runCliInProcess({
    argv: [
      "bootstrap",
      "--email",
      ADMIN_EMAIL,
      "--database",
      file,
      "--create-new",
      "--allow-live",
    ],
    env: { ...env, ADMIN_PASSWORD: ADMIN_SECRET },
    stdin: ttyStdin(["yes"]),
    stdout: stdoutRecorder(),
  });
  assert.equal(wrongWord, 1);
  assert.equal(fs.existsSync(file), false, "an unexact confirmation writes nothing");
});

test("A1-3 the repository live database is a live target that a refusal never opens", async () => {
  const liveFile = path.join(repoRoot, "data", "academy.db");
  const before = sha256File(liveFile);

  const noFlag = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", liveFile],
    { ADMIN_PASSWORD: ADMIN_SECRET },
  );
  assert.equal(noFlag.code, 1);
  assert.equal(noFlag.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");

  const nonInteractive = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL, "--database", liveFile, "--allow-live"],
    { ADMIN_PASSWORD: ADMIN_SECRET },
  );
  assert.equal(nonInteractive.code, 1);
  assert.equal(nonInteractive.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");

  assert.equal(sha256File(liveFile), before, "the live database bytes are unchanged");
  for (const output of [noFlag, nonInteractive]) {
    assertNoPathOrSecret(`${output.stdout}${output.stderr}`, "live refusal");
  }
});

test("A1-4 typing LIVE at a terminal lets a declared-live target through and says only TARGET=live", async () => {
  const env = envFor("a1-live-confirm");
  const file = env.GRANDMASTER_DB_PATH;
  const stdout = stdoutRecorder();

  const exitCode = await runCliInProcess({
    argv: [
      "bootstrap",
      "--email",
      ADMIN_EMAIL,
      "--database",
      file,
      "--create-new",
      "--allow-live",
    ],
    env: { ...env, ADMIN_PASSWORD: ADMIN_SECRET },
    stdin: ttyStdin(["LIVE"]),
    stdout,
  });

  assert.equal(exitCode, 0);
  assert.equal(
    stdout.lines.join(""),
    "Type LIVE to write to the live database: LIVE\nTARGET=live\nRESULT=ADMIN_CREATED\n",
  );
  assertNoPathOrSecret(stdout.lines.join(""), "live confirmation output");

  const db = await openDb("a1-live-confirm");
  assert.equal((await adminRow(db)).email, ADMIN_EMAIL);
});

test("A1-5 a missing target is created only by bootstrap with --create-new", async () => {
  const bootstrapFile = path.join(scratchCase("a1-create-rule"), "probe.db");
  const resetFile = path.join(scratchCase("a1-reset-rule"), "probe.db");

  const plain = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", bootstrapFile],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(plain.code, 1);
  assert.equal(plain.stdout, "ERROR=BOOTSTRAP_DATABASE_NOT_FOUND\n");
  assert.equal(fs.existsSync(bootstrapFile), false, "bootstrap needs the create flag");

  const created = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", bootstrapFile, "--create-new"],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(created.code, 0);
  assert.equal(created.stdout, "TARGET=custom\nRESULT=ADMIN_CREATED\n");
  assert.equal(fs.existsSync(bootstrapFile), true);

  // With the file genuinely present the same command needs no flag at all.
  const repeat = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", bootstrapFile],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(repeat.code, 0);
  assert.equal(repeat.stdout, "TARGET=custom\nRESULT=ADMIN_ALREADY_PROVISIONED\n");

  // --create-new never applies to reset-password: a reset must not invent an
  // empty database and then report that the admin was not found.
  const reset = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL, "--database", resetFile, "--create-new"],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(reset.code, 1);
  assert.equal(reset.stdout, "ERROR=BOOTSTRAP_DATABASE_NOT_FOUND\n");
  assert.equal(fs.existsSync(resetFile), false);
});

test("A1-6 switch flags are parsed as flags and every safeguard output stays a code", async () => {
  const env = envFor("a1-switches");
  const file = env.GRANDMASTER_DB_PATH;

  const reordered = await runCli(
    ["bootstrap", "--create-new", "--allow-live", "--email", ADMIN_EMAIL, "--database", file],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(reordered.code, 0, "a switch flag must not swallow the next value flag");
  assert.equal(reordered.stdout, "TARGET=custom\nRESULT=ADMIN_CREATED\n");

  const allowLiveOnCustom = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", file, "--allow-live"],
    scratchEnv({ ADMIN_PASSWORD: ADMIN_SECRET }),
  );
  assert.equal(
    allowLiveOnCustom.stdout,
    "TARGET=custom\nRESULT=ADMIN_ALREADY_PROVISIONED\n",
    "the live permission is inert for a target that is not live",
  );
  assert.equal(allowLiveOnCustom.code, 0);

  const dangling = await runCli(["bootstrap", "--email"], scratchEnv());
  assert.equal(dangling.code, 1);
  assert.equal(dangling.stdout, "ERROR=BOOTSTRAP_USAGE_INVALID\n");

  const switchOnly = await runCli(["bootstrap", "--create-new"], scratchEnv());
  assert.equal(switchOnly.code, 1);
  assert.equal(switchOnly.stdout, "ERROR=BOOTSTRAP_TARGET_REQUIRED\n");

  for (const output of [reordered, allowLiveOnCustom, dangling, switchOnly]) {
    assertNoPathOrSecret(`${output.stdout}${output.stderr}`, "switch flag output");
    assert.equal(output.stderr, "");
  }

  assert.equal(fs.existsSync(file), true);
});

/* ---------------------------------------------------------------------------
 * A3 - the live-target guard reads a file's identity, not its spelling.
 *
 * Every case below declares some path under the scratch root to be the
 * protected database and then reaches it through an alias. None of them points
 * at the repository's real database, and a refusal is always proven by the
 * protected file's hash not moving.
 * ------------------------------------------------------------------------ */

function caseDir(name) {
  const dir = path.join(dataDir, `a3-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function liveGuardEnv(protectedFile, overrides = {}) {
  return {
    ADMIN_PASSWORD: ADMIN_SECRET,
    GRANDMASTER_DB_PATH: protectedFile,
    GRANDMASTER_DATA_DIR: path.dirname(protectedFile),
    ...overrides,
  };
}

// C2 asks for the platform to prove itself before the guard is trusted: a
// hardlink must answer with one identity, and a reparse point must resolve.
test("A3-0 this platform reports one (dev, ino) pair for a hardlink and resolves a junction", async (t) => {
  const dir = caseDir("platform");
  const original = path.join(dir, "original.db");
  fs.writeFileSync(original, "BYTES");
  const sibling = path.join(dir, "sibling.db");
  try {
    fs.linkSync(original, sibling);
  } catch (error) {
    t.skip(`SKIP: hardlink creation failed on this volume (${error.code || error.name}); file identity is unavailable here`);
    return;
  }
  const first = fs.statSync(fs.realpathSync.native(original), { bigint: true });
  const second = fs.statSync(fs.realpathSync.native(sibling), { bigint: true });
  assert.equal(typeof first.dev, "bigint", "the stats must be read as BigInts");
  assert.equal(typeof first.ino, "bigint", "the stats must be read as BigInts");
  assert.equal(
    first.dev === second.dev && first.ino === second.ino,
    true,
    "identity is unreliable on this platform: a hardlink does not share its (dev, ino) pair",
  );
  assert.notEqual(
    fs.realpathSync.native(original),
    fs.realpathSync.native(sibling),
    "resolution alone cannot see a hardlink, which is why the pair is compared",
  );

  const link = path.join(dir, "junction");
  try {
    fs.symlinkSync(dir, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`SKIP: reparse-point creation failed (${error.code || error.name})`);
    return;
  }
  assert.equal(
    fs.realpathSync.native(path.join(link, "original.db")),
    fs.realpathSync.native(original),
    "a reparse point resolves to the protected file",
  );
});

test("A3-1 a junction alias of a protected database is a live target, and LIVE still unlocks it", async (t) => {
  const dir = caseDir("junction");
  const liveDir = path.join(dir, "live");
  fs.mkdirSync(liveDir);
  const protectedFile = path.join(liveDir, "academy.db");
  await provisionScratchLive(protectedFile);
  const hashBefore = sha256File(protectedFile);

  const link = path.join(dir, "alias-dir");
  try {
    fs.symlinkSync(liveDir, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`SKIP: junction creation failed (${error.code || error.name})`);
    return;
  }
  const aliasTarget = path.join(link, "academy.db");
  assert.notEqual(path.resolve(aliasTarget), protectedFile, "the alias is a different spelling");

  const refused = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL, "--database", aliasTarget],
    liveGuardEnv(protectedFile),
  );
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
  assertNoPathOrSecret(`${refused.stdout}${refused.stderr}`, "junction refusal");
  assert.equal(sha256File(protectedFile), hashBefore, "a refused alias never opens the database");

  const withFlagOnly = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL, "--database", aliasTarget, "--allow-live"],
    liveGuardEnv(protectedFile),
  );
  assert.equal(withFlagOnly.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");

  // The two-step confirmation is not weakened by the alias: it still works.
  const stdout = stdoutRecorder();
  const exitCode = await runCliInProcess({
    argv: ["bootstrap", "--email", ADMIN_EMAIL, "--database", aliasTarget, "--allow-live"],
    env: liveGuardEnv(protectedFile),
    stdin: ttyStdin(["LIVE"]),
    stdout,
  });
  assert.equal(exitCode, 0);
  assert.equal(
    stdout.lines.join(""),
    "Type LIVE to write to the live database: LIVE\nTARGET=live\nRESULT=ADMIN_ALREADY_PROVISIONED\n",
  );
  assertNoPathOrSecret(stdout.lines.join(""), "junction live confirmation");
});

test("A3-2 a symbolic-link alias of a protected database is a live target", async (t) => {
  const dir = caseDir("symlink");
  const liveDir = path.join(dir, "live");
  fs.mkdirSync(liveDir);
  const protectedFile = path.join(liveDir, "academy.db");
  await provisionScratchLive(protectedFile);
  const hashBefore = sha256File(protectedFile);

  const aliasFile = path.join(dir, "alias.db");
  try {
    fs.symlinkSync(protectedFile, aliasFile, "file");
  } catch (error) {
    t.skip(`SKIP: symbolic-link creation needs privilege this process does not have (${error.code || error.name}); on Windows this is EPERM without Developer Mode or admin rights`);
    return;
  }
  const refused = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL, "--database", aliasFile],
    liveGuardEnv(protectedFile),
  );
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
  assertNoPathOrSecret(`${refused.stdout}${refused.stderr}`, "symlink refusal");
  assert.equal(sha256File(protectedFile), hashBefore);
});

test("A3-3 a hardlink sibling of a protected database is a live target", async (t) => {
  const dir = caseDir("hardlink");
  const protectedFile = path.join(dir, "academy.db");
  await provisionScratchLive(protectedFile);
  const hashBefore = sha256File(protectedFile);

  const aliasFile = path.join(dir, "sibling.db");
  try {
    fs.linkSync(protectedFile, aliasFile);
  } catch (error) {
    t.skip(`SKIP: hardlink creation failed on this volume (${error.code || error.name})`);
    return;
  }
  assert.notEqual(
    fs.realpathSync.native(aliasFile),
    fs.realpathSync.native(protectedFile),
    "resolution cannot see a hardlink, so this is the alias the pair comparison exists for",
  );

  const refused = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL, "--database", aliasFile],
    liveGuardEnv(protectedFile),
  );
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
  assertNoPathOrSecret(`${refused.stdout}${refused.stderr}`, "hardlink refusal");
  assert.equal(sha256File(protectedFile), hashBefore, "the protected database is never opened");
  assert.equal(fs.existsSync(aliasFile), true, "the refusal happened on identity, not existence");
});

test("A3-4 a short (8.3) path alias of a protected database is a live target", async (t) => {
  if (process.platform !== "win32") {
    t.skip("SKIP: 8.3 short names are a Windows filesystem feature");
    return;
  }
  const dir = caseDir("shortname");
  const liveDir = path.join(dir, "live");
  fs.mkdirSync(liveDir);
  const protectedFile = path.join(liveDir, "academy.db");
  await provisionScratchLive(protectedFile);
  const hashBefore = sha256File(protectedFile);

  let shortDir;
  try {
    shortDir = execSync(`cmd /c for %A in ("${liveDir}") do @echo %~sA`, {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    t.skip(`SKIP: the short-name query could not run (${String(error.message || error).slice(0, 60)})`);
    return;
  }
  if (shortDir.toLowerCase() === liveDir.toLowerCase()) {
    t.skip("SKIP: 8.3 short-name generation is disabled on this volume, so no alias can be built");
    return;
  }

  const aliasTarget = path.join(shortDir, "academy.db");
  const refused = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL, "--database", aliasTarget],
    liveGuardEnv(protectedFile),
  );
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
  assertNoPathOrSecret(`${refused.stdout}${refused.stderr}`, "short-name refusal");
  assert.equal(sha256File(protectedFile), hashBefore);
});

test("A3-5 an extended-length, device or UNC target is refused without touching the filesystem", async (t) => {
  if (process.platform !== "win32") {
    t.skip("SKIP: these namespace prefixes are Windows path syntax");
    return;
  }
  const env = {
    ...process.env,
    ADMIN_PASSWORD: ADMIN_SECRET,
    GRANDMASTER_DB_PATH: "",
    GRANDMASTER_DATA_DIR: caseDir("namespace"),
  };

  for (const raw of [
    "\\\\?\\D:\\anywhere\\academy.db",
    "//?/D:/anywhere/academy.db",
    "\\\\?\\UNC\\host\\share\\academy.db",
    "\\\\.\\PHYSICALDRIVE0",
    "\\\\host\\share\\academy.db",
    "//host/share/academy.db",
  ]) {
    const { result, calls } = await withFilesystemSpy(() =>
      runCliInProcess({
        argv: ["bootstrap", "--email", ADMIN_EMAIL, "--database", raw],
        env,
        stdin: deadStdin(),
        stdout: stdoutRecorder(),
      }),
    );
    assert.equal(result, 1, `${raw.slice(0, 12)} is refused`);
    assert.equal(calls.length, 0, `no filesystem call may happen for ${raw.slice(0, 12)}`);
  }

  const stdout = stdoutRecorder();
  const exitCode = await runCliInProcess({
    argv: ["reset-password", "--email", ADMIN_EMAIL, "--database", "\\\\?\\C:\\x\\academy.db"],
    env,
    stdin: deadStdin(),
    stdout,
  });
  assert.equal(exitCode, 1);
  assert.equal(stdout.lines.join(""), "ERROR=BOOTSTRAP_TARGET_UNSUPPORTED\n");
  assertNoPathOrSecret(stdout.lines.join(""), "unsupported target refusal");

  // The rule filters operator input, never a resolved path: a legitimate target
  // in its own directory still works.
  const okDir = path.join(env.GRANDMASTER_DATA_DIR, "ok");
  fs.mkdirSync(okDir, { recursive: true });
  const ok = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", path.join(okDir, "fine.db"), "--create-new"],
    env,
  );
  assert.equal(ok.stdout, "TARGET=custom\nRESULT=ADMIN_CREATED\n");
});

test("A3-6 a target that only the ambient configuration resolves to is a live target", async () => {
  const dir = caseDir("env-mismatch");
  const dataDirCase = path.join(dir, "store");
  fs.mkdirSync(dataDirCase, { recursive: true });
  const protectedFile = path.join(dataDirCase, "academy.db");
  await provisionScratchLive(protectedFile);
  const hashBefore = sha256File(protectedFile);

  // GRANDMASTER_DB_PATH points somewhere else while GRANDMASTER_DATA_DIR points
  // at the real store: the target is what the data directory resolves to.
  const refused = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL, "--database", protectedFile],
    {
      ADMIN_PASSWORD: ADMIN_SECRET,
      GRANDMASTER_DB_PATH: path.join(dir, "elsewhere.db"),
      GRANDMASTER_DATA_DIR: dataDirCase,
    },
  );
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
  assertNoPathOrSecret(`${refused.stdout}${refused.stderr}`, "env mismatch refusal");
  assert.equal(sha256File(protectedFile), hashBefore);
});

test("A3-7 a relative, dotted, case-folded or mixed-separator spelling is the same live target", async () => {
  const dir = caseDir("spellings");
  const protectedFile = path.join(dir, "academy.db");
  await provisionScratchLive(protectedFile);
  const hashBefore = sha256File(protectedFile);

  const spellings = [
    ["relative", "academy.db", dir],
    ["dot-dot", path.join(dir, "live", "..", "academy.db"), repoRoot],
    ["forward-slash", dir.replace(/\\/g, "/") + "/academy.db", repoRoot],
  ];
  if (process.platform === "win32") {
    spellings.push(["case-variant", path.join(dir, "ACADEMY.DB"), repoRoot]);
  }

  for (const [name, target, cwd] of spellings) {
    const refused = await runCli(
      ["reset-password", "--email", ADMIN_EMAIL, "--database", target],
      liveGuardEnv(protectedFile),
      { cwd },
    );
    assert.equal(refused.code, 1, `${name} is refused`);
    assert.equal(refused.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n", name);
    assertNoPathOrSecret(`${refused.stdout}${refused.stderr}`, `${name} refusal`);
  }
  assert.equal(sha256File(protectedFile), hashBefore, "no spelling opened the database");
});

test("A3-8 creating a database inside a protected directory is a live operation", async () => {
  const dir = caseDir("ambient-dir");
  const store = path.join(dir, "store");
  fs.mkdirSync(store, { recursive: true });

  const brandNew = path.join(store, "brand-new.db");
  const ambient = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", brandNew, "--create-new"],
    {
      ADMIN_PASSWORD: ADMIN_SECRET,
      GRANDMASTER_DB_PATH: "",
      GRANDMASTER_DATA_DIR: store,
    },
  );
  assert.equal(ambient.code, 1);
  assert.equal(ambient.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
  assert.equal(fs.existsSync(brandNew), false, "a refused live write creates nothing");
  assertNoPathOrSecret(`${ambient.stdout}${ambient.stderr}`, "ambient directory refusal");

  // The same creation through a reparse point at that directory is refused too.
  let aliasDir;
  let skipped = null;
  try {
    aliasDir = path.join(dir, "alias");
    fs.symlinkSync(store, aliasDir, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    skipped = error.code || error.name;
  }
  if (skipped) {
    // The direct case above already pins the rule; the alias variant is not
    // buildable here, and that is reported rather than counted as a pass.
    return;
  }
  const aliased = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", path.join(aliasDir, "other.db"), "--create-new"],
    { ADMIN_PASSWORD: ADMIN_SECRET, GRANDMASTER_DB_PATH: "", GRANDMASTER_DATA_DIR: store },
  );
  assert.equal(aliased.stdout, "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
  assert.equal(fs.existsSync(path.join(store, "other.db")), false);
});

test("A3-9 an ordinary scratch database and a parent that does not exist yet stay custom", async () => {
  const dir = caseDir("custom-paths");
  const ambient = {
    ADMIN_PASSWORD: ADMIN_SECRET,
    GRANDMASTER_DB_PATH: "",
    GRANDMASTER_DATA_DIR: dir,
  };

  // A missing parent directory cannot be an alias of anything, so creating
  // through it stays an ordinary custom write.
  const nested = path.join(dir, "not", "there", "yet.db");
  const created = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", nested, "--create-new"],
    ambient,
  );
  assert.equal(created.code, 0);
  assert.equal(created.stdout, "TARGET=custom\nRESULT=ADMIN_CREATED\n");
  assert.equal(fs.existsSync(nested), true);

  // A valid custom database in its own directory keeps working, both commands.
  const own = path.join(dir, "own", "academy.db");
  fs.mkdirSync(path.dirname(own), { recursive: true });
  const first = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", own, "--create-new"],
    ambient,
  );
  assert.equal(first.stdout, "TARGET=custom\nRESULT=ADMIN_CREATED\n");
  const rotated = await runCli(
    ["reset-password", "--email", ADMIN_EMAIL, "--database", own],
    { ...ambient, ADMIN_PASSWORD: ROTATED_SECRET },
  );
  assert.equal(rotated.stdout, "TARGET=custom\nRESULT=ADMIN_PASSWORD_RESET\n");
  for (const output of [created, first, rotated]) {
    assertNoPathOrSecret(`${output.stdout}${output.stderr}`, "custom write output");
  }

  // A custom target whose parent exists but is empty is still not live.
  const sibling = path.join(dir, "own", "second.db");
  const second = await runCli(
    ["bootstrap", "--email", ADMIN_EMAIL, "--database", sibling, "--create-new"],
    ambient,
  );
  assert.equal(second.stdout, "TARGET=custom\nRESULT=ADMIN_CREATED\n");
});

test("A3-10 a target whose identity cannot be read or compared is refused, not trusted", async () => {
  // The protected store is a sibling directory, so the target below is a plain
  // custom file: every refusal measured here is caused by the missing identity
  // and not by where the file happens to sit.
  const dir = caseDir("unreadable");
  const ambient = path.join(dir, "ambient");
  fs.mkdirSync(ambient, { recursive: true });
  const file = path.join(dir, "target.db");
  const env = {
    ...process.env,
    ADMIN_PASSWORD: ADMIN_SECRET,
    GRANDMASTER_DB_PATH: "",
    GRANDMASTER_DATA_DIR: ambient,
  };

  const control = stdoutRecorder();
  const controlExit = await runCliInProcess({
    argv: ["bootstrap", "--email", ADMIN_EMAIL, "--database", file, "--create-new"],
    env,
    stdin: deadStdin(),
    stdout: control,
  });
  assert.equal(controlExit, 0, "a readable identity leaves the target custom");
  assert.equal(control.lines.join(""), "TARGET=custom\nRESULT=ADMIN_CREATED\n");
  const bytesBefore = sha256File(file);

  // C5: resolution fails for a file that is there, so it is treated as live.
  const realNative = fs.realpathSync.native;
  fs.realpathSync.native = (target, ...rest) => {
    if (target === file) throw new Error("EPERM injected");
    return realNative(target, ...rest);
  };
  try {
    const stdout = stdoutRecorder();
    const exitCode = await runCliInProcess({
      argv: ["reset-password", "--email", ADMIN_EMAIL, "--database", file],
      env,
      stdin: deadStdin(),
      stdout,
    });
    assert.equal(exitCode, 1);
    assert.equal(stdout.lines.join(""), "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
    assertNoPathOrSecret(stdout.lines.join(""), "fail-closed refusal");

    // A non-interactive caller cannot clear the gate even with the flag, which is
    // what keeps CI away from a path the guard is unsure about.
    const flagged = stdoutRecorder();
    const flaggedExit = await runCliInProcess({
      argv: [
        "reset-password",
        "--email",
        ADMIN_EMAIL,
        "--database",
        file,
        "--allow-live",
      ],
      env,
      stdin: deadStdin(),
      stdout: flagged,
    });
    assert.equal(flaggedExit, 1);
    assert.equal(flagged.lines.join(""), "ERROR=BOOTSTRAP_LIVE_TARGET_NOT_CONFIRMED\n");
    assertNoPathOrSecret(flagged.lines.join(""), "flagged non-interactive refusal");
  } finally {
    fs.realpathSync.native = realNative;
  }

  // C2: a volume that answers with a zero file index cannot be compared against.
  const realStat = fs.statSync;
  fs.statSync = (target, options) => {
    const stats = realStat(target, options);
    if (target === fs.realpathSync.native(file)) {
      return { ...stats, dev: 0n, ino: 0n };
    }
    return stats;
  };
  try {
    const stdout = stdoutRecorder();
    const exitCode = await runCliInProcess({
      argv: ["bootstrap", "--email", ADMIN_EMAIL, "--database", file],
      env,
      stdin: deadStdin(),
      stdout,
    });
    assert.equal(exitCode, 1);
    assert.equal(stdout.lines.join(""), "ERROR=BOOTSTRAP_TARGET_IDENTITY_UNRELIABLE\n");
    assertNoPathOrSecret(stdout.lines.join(""), "unreliable identity refusal");
  } finally {
    fs.statSync = realStat;
  }

  assert.equal(sha256File(file), bytesBefore, "no refusal opened the database");
});

test("A3-10b a stat call that returns no bigint pair is refused as unreliable", async () => {
  const dir = caseDir("stat-shape");
  const ambient = path.join(dir, "ambient");
  fs.mkdirSync(ambient, { recursive: true });
  const file = path.join(dir, "plain.db");
  fs.writeFileSync(file, "NOT-A-DATABASE");
  const realStat = fs.statSync;
  fs.statSync = (target, options) => {
    const stats = realStat(target, options);
    if (target === fs.realpathSync.native(file)) {
      return { ...stats, dev: 1n, ino: undefined };
    }
    return stats;
  };
  try {
    const stdout = stdoutRecorder();
    const exitCode = await runCliInProcess({
      argv: ["bootstrap", "--email", ADMIN_EMAIL, "--database", file],
      env: {
        ...process.env,
        ADMIN_PASSWORD: ADMIN_SECRET,
        GRANDMASTER_DB_PATH: "",
        GRANDMASTER_DATA_DIR: ambient,
      },
      stdin: deadStdin(),
      stdout,
    });
    assert.equal(exitCode, 1);
    assert.equal(stdout.lines.join(""), "ERROR=BOOTSTRAP_TARGET_IDENTITY_UNRELIABLE\n");
  } finally {
    fs.statSync = realStat;
  }
  assert.equal(fs.readFileSync(file, "utf8"), "NOT-A-DATABASE", "the file was never opened");
});

test("A3-11 an identity that moves between validation and open aborts before the credential write", async () => {
  // The change is injected, not raced: this pins that the re-read after
  // `DatabaseSync` opens is compared and acted on. The window itself stays a
  // residual limitation - see the A3 report.
  const dir = caseDir("drift");
  const ambient = path.join(dir, "ambient");
  fs.mkdirSync(ambient, { recursive: true });
  const file = path.join(dir, "target.db");
  const decoy = path.join(dir, "decoy.db");
  fs.writeFileSync(decoy, "DECOY");
  const env = {
    ...process.env,
    ADMIN_PASSWORD: ADMIN_SECRET,
    GRANDMASTER_DB_PATH: "",
    GRANDMASTER_DATA_DIR: ambient,
  };

  await resetDatabaseForTests();
  const seeding = getDatabase({ ...env, GRANDMASTER_DB_PATH: file });
  await seeding.get("SELECT COUNT(*) AS c FROM users");
  await closeDatabase();

  const realNative = fs.realpathSync.native;
  let reads = 0;
  fs.realpathSync.native = (target, ...rest) => {
    if (target === file) {
      reads += 1;
      if (reads > 1) return decoy;
    }
    return realNative(target, ...rest);
  };
  let exitCode;
  let stdout;
  try {
    stdout = stdoutRecorder();
    exitCode = await runCliInProcess({
      argv: ["bootstrap", "--email", ADMIN_EMAIL, "--database", file],
      env,
      stdin: deadStdin(),
      stdout,
    });
  } finally {
    fs.realpathSync.native = realNative;
  }

  assert.ok(reads > 1, "the identity was read again after the handle opened");
  assert.equal(exitCode, 1);
  assert.equal(stdout.lines.join(""), "TARGET=custom\nERROR=BOOTSTRAP_TARGET_IDENTITY_CHANGED\n");
  assertNoPathOrSecret(stdout.lines.join(""), "drift refusal");

  // No byte-for-byte comparison of the target: opening the handle is allowed to
  // rewrite its WAL header, so what is provable is that no credential landed.
  assert.equal(fs.readFileSync(decoy, "utf8"), "DECOY", "the alias was never written through");

  await resetDatabaseForTests();
  const db = getDatabase({ ...env, GRANDMASTER_DB_PATH: file });
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM users")).c, 0, "no account was created");
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'")).c, 0);
  assert.equal(
    (await db.all("SELECT id FROM audit_log WHERE action = ?", [ADMIN_BOOTSTRAP_ACTIONS.PROVISION]))
      .length,
    0,
    "no bootstrap audit row was written",
  );
  await closeDatabase();
});

test("A3-12 the guard reads bigint identity and never calls itself race-free", () => {
  const cliSource = sourceText(path.posix.join("scripts", "bootstrap-admin.mjs"));
  assert.match(cliSource, /realpathSync\.native/, "the alias must be resolved, not assumed");
  assert.match(cliSource, /statSync\(canonical, \{ bigint: true \}\)/, "the pair must be read as BigInts");
  assert.match(cliSource, /first\.dev === second\.dev && first\.ino === second\.ino/);
  assert.ok(!/race-free/i.test(cliSource), "the residual window must not be described as closed");
  assert.match(cliSource, /does not close it/, "the residual window is named as one");
  assert.match(cliSource, /BOOTSTRAP_TARGET_UNSUPPORTED/, "the raw namespaces need their own code");
  assert.doesNotMatch(
    cliSource,
    /emit\([^)]*resolvedTarget|emit\([^)]*liveDatabasePath/,
    "a target path never reaches the output",
  );
});
