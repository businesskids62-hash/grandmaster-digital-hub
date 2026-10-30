import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-academy-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_SESSION_SECRET = "academy-session-secret-0123456789abcdef0123456789";
process.env.GRANDMASTER_UI_PASSWORD = "legacy-owner-password-123";
process.env.ADMIN_EMAIL = "owner@example.com";
process.env.ADMIN_PASSWORD = "owner-password-123";
process.env.AUTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.BCRYPT_ROUNDS = "4";
process.env.GRANDMASTER_LOG_SILENT = "1";
delete process.env.VERCEL;
delete process.env.NODE_ENV;

const { closeDatabase, databaseStatus, getDatabase } = await import("../lib/db/index.js");
const { MIGRATIONS } = await import("../lib/db/migrations.js");
const { SEED_IDS } = await import("../lib/db/seed.js");
const { hashPassword, passwordProblem, verifyPasswordHash } = await import(
  "../lib/auth/passwords.js"
);
const {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionToken,
  createUserSessionToken,
  verifySessionToken,
} = await import("../lib/auth/session.js");
const { resolveSession, isAdmin } = await import("../lib/auth/guards.js");
const { createCsrfToken } = await import("../lib/auth/csrf.js");
const {
  authenticateUser,
  consumePasswordReset,
  createPasswordReset,
  deleteUserAccount,
  signupUser,
} = await import("../lib/auth/accounts.js");
const {
  checkAuthRateLimit,
  handleChangePassword,
  handleDeleteAccount,
  handleForgotPassword,
  handleLogin,
  handleLogout,
  handleResetPassword,
  handleSession,
  handleSignup,
  resetAuthRateLimits,
} = await import("../lib/auth/routes.js");
const {
  completeLesson,
  getCourse,
  getProgress,
  getQuizForClient,
  listAttempts,
  submitQuizAttempt,
} = await import("../lib/academy/service.js");
const { handleAcademy } = await import("../lib/api/academy.js");
const { handleAdminStats, readSignInStats } = await import("../lib/admin/stats.js");
const { requireSession } = await import("../lib/vercelHttp.js");
const { createApp } = await import("../server/server.js");

let sequence = 0;

function nextId(prefix) {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function rawCookies(result) {
  const raw = result?.headers?.["Set-Cookie"];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((entry) => String(entry));
}

function cookiePairs(result) {
  return rawCookies(result)
    .map((entry) => entry.split(";")[0])
    .filter(Boolean);
}

function cookiesFrom(result) {
  const pairs = cookiePairs(result);
  const cookie = pairs.join("; ");
  const csrfPair = pairs.find((pair) => pair.startsWith("gm_csrf=")) || "";
  return { cookie, csrf: csrfPair.split("=")[1] || "", raw: pairs };
}

function signup(email, password = "student-password-1") {
  return handleSignup({
    method: "POST",
    headers: {},
    body: { email, password },
    env: process.env,
    clientKey: nextId("signup-client"),
    requestId: nextId("signup-request"),
  });
}

async function login(email, password = "student-password-1") {
  return handleLogin({
    method: "POST",
    headers: {},
    body: { email, password },
    env: process.env,
    clientKey: nextId("login-client"),
    requestId: nextId("login-request"),
  });
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    headersSent: false,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
}

const db = getDatabase(process.env);

after(async () => {
  await closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("migrations create the academy schema and seed one course with a quiz", async () => {
  const versions = (await db.all("SELECT version FROM schema_migrations")).map(
    (row) => row.version,
  );
  assert.equal(versions.length, MIGRATIONS.length);

  const tables = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
    (row) => row.name,
  );
  for (const table of [
    "users",
    "password_resets",
    "courses",
    "lessons",
    "quizzes",
    "questions",
    "quiz_attempts",
    "progress",
    "audit_log",
    "login_events",
  ]) {
    assert.ok(tables.includes(table), `missing table ${table}`);
  }

  assert.equal((await db.get("SELECT COUNT(*) AS c FROM courses")).c, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM lessons")).c, 3);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM quizzes")).c, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM questions")).c, 5);

  const course = await db.get("SELECT title, slug FROM courses WHERE id = ?", [SEED_IDS.course]);
  assert.equal(course.title, "Trading Basics");
  assert.equal(course.slug, "trading-basics");

  const status = await databaseStatus(process.env);
  assert.equal(status.ok, true);
  assert.equal(status.engine, "sqlite");
  assert.equal(status.migrations, MIGRATIONS.length);
});

test("seeded admin uses a bcrypt hash and per-user login replaces the shared password", async () => {
  const admin = await db.get("SELECT * FROM users WHERE email = ?", ["owner@example.com"]);
  assert.ok(admin);
  assert.equal(admin.role, "admin");
  assert.match(admin.password_hash, /^\$2[aby]\$/);
  assert.notEqual(admin.password_hash, process.env.ADMIN_PASSWORD);
  assert.equal(verifyPasswordHash(process.env.ADMIN_PASSWORD, admin.password_hash), true);

  const adminLogin = await login("owner@example.com", process.env.ADMIN_PASSWORD);
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.body.user.role, "admin");

  // ADMIN_EMAIL is configured, so the legacy shared password must not sign in.
  const legacy = await login("", process.env.GRANDMASTER_UI_PASSWORD);
  assert.equal(legacy.status, 401);
  assert.equal(legacy.body.code, "AUTH_INVALID_CREDENTIALS");
});

test("password hashing never stores plaintext and enforces a minimum length", () => {
  const hash = hashPassword("correct-horse-battery-1", process.env);
  assert.notEqual(hash, "correct-horse-battery-1");
  assert.match(hash, /^\$2[aby]\$/);
  assert.equal(verifyPasswordHash("correct-horse-battery-1", hash), true);
  assert.equal(verifyPasswordHash("wrong-password-value", hash), false);
  assert.equal(verifyPasswordHash("anything", ""), false);

  assert.match(passwordProblem("short"), /at least 10/);
  assert.equal(passwordProblem("0123456789"), null);
  assert.match(passwordProblem("x".repeat(201)), /too long/);
});

test("signup creates a student session, rejects weak input and never confirms duplicates", async () => {
  resetAuthRateLimits();
  const created = await signup("Student.One@Example.com");
  assert.equal(created.status, 201);
  assert.equal(created.body.user.role, "student");
  assert.equal(created.body.user.email, "student.one@example.com");
  assert.equal(Object.prototype.hasOwnProperty.call(created.body.user, "passwordHash"), false);

  const raw = rawCookies(created);
  assert.ok(raw.some((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`)));
  assert.ok(raw.some((entry) => /^gm_csrf=[0-9a-f]{64};/.test(entry)));
  const sessionCookie = raw.find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`));
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Strict/i);
  assert.doesNotMatch(
    raw.find((entry) => entry.startsWith("gm_csrf=")),
    /HttpOnly/i,
  );

  const row = await db.get("SELECT password_hash FROM users WHERE email = ?", [
    "student.one@example.com",
  ]);
  assert.match(row.password_hash, /^\$2[aby]\$/);
  assert.notEqual(row.password_hash, "student-password-1");

  const duplicate = await signup("student.one@example.com");
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.code, "SIGNUP_UNAVAILABLE");
  assert.equal(duplicate.body.user, undefined);
  assert.doesNotMatch(duplicate.body.error, /already|exists|taken/i);

  const weak = await signup("weak.password@example.com", "short");
  assert.equal(weak.status, 400);
  assert.equal(weak.body.code, "WEAK_PASSWORD");

  const badEmail = await signup("not-an-email", "student-password-1");
  assert.equal(badEmail.status, 400);
  assert.equal(badEmail.body.code, "INVALID_EMAIL");
});

test("login, session and logout round trip with generic credential errors", async () => {
  const good = await login("student.one@example.com");
  assert.equal(good.status, 200);
  assert.equal(good.body.authenticated, true);
  assert.equal(good.body.user.email, "student.one@example.com");
  assert.equal(good.body.user.role, "student");
  const { cookie } = cookiesFrom(good);

  const session = await handleSession({
    headers: { cookie },
    env: process.env,
    requestId: "session-ok",
  });
  assert.equal(session.status, 200);
  assert.equal(session.body.user.role, "student");

  const wrong = await login("student.one@example.com", "definitely-wrong-pass");
  const unknown = await login("nobody@example.com", "definitely-wrong-pass");
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error, unknown.body.error);
  assert.doesNotMatch(wrong.body.error, /not found|unknown|exists/i);

  const denied = await handleSession({ headers: {}, env: process.env, requestId: "session-none" });
  assert.equal(denied.status, 401);

  const logout = await handleLogout({ headers: { cookie }, env: process.env, requestId: "logout" });
  assert.equal(logout.status, 200);
  const cleared = rawCookies(logout).join("\n");
  assert.match(cleared, /gm_session=;/);
  assert.match(cleared, /Max-Age=0/i);
  assert.match(cleared, /gm_csrf=;/);
});

test("successful sign-ins are recorded and failed attempts are not", async () => {
  const email = "tracked.learner@example.com";
  const before = Number((await db.get("SELECT COUNT(*) AS c FROM login_events")).c);

  assert.equal((await signup(email)).status, 201);
  const userId = (await db.get("SELECT id FROM users WHERE email = ?", [email])).id;
  const countForUser = async () =>
    Number((await db.get("SELECT COUNT(*) AS c FROM login_events WHERE user_id = ?", [userId])).c);
  assert.equal(await countForUser(), 1);

  assert.equal((await login(email)).status, 200);
  assert.equal(await countForUser(), 2);

  const afterSuccess = Number((await db.get("SELECT COUNT(*) AS c FROM login_events")).c);
  assert.equal((await login(email, "wrong-password-value")).status, 401);
  assert.equal(Number((await db.get("SELECT COUNT(*) AS c FROM login_events")).c), afterSuccess);
  assert.equal(afterSuccess, before + 2);

  const latest = await db.get(
    "SELECT created_at FROM login_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  assert.match(latest.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("admin stats are admin-only and report sign-in totals", async () => {
  const anonymous = await handleAdminStats({
    method: "GET",
    headers: {},
    env: process.env,
    requestId: "stats-anon",
  });
  assert.equal(anonymous.status, 401);

  const student = await login("student.one@example.com");
  const { cookie: studentCookie } = cookiesFrom(student);
  const forbidden = await handleAdminStats({
    method: "GET",
    headers: { cookie: studentCookie },
    env: process.env,
    requestId: "stats-student",
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, "ROLE_FORBIDDEN");

  const admin = await login("owner@example.com", "owner-password-123");
  assert.equal(admin.status, 200);
  const { cookie: adminCookie } = cookiesFrom(admin);
  const stats = await handleAdminStats({
    method: "GET",
    headers: { cookie: adminCookie },
    env: process.env,
    requestId: "stats-admin",
  });
  assert.equal(stats.status, 200);
  assert.equal(stats.body.ok, true);

  const expected = await readSignInStats(db);
  for (const key of ["signups", "totalLogins", "uniqueSignedIn", "today"]) {
    assert.equal(stats.body[key], expected[key]);
    assert.equal(Number.isInteger(stats.body[key]), true);
  }
  assert.equal(
    stats.body.signups,
    Number((await db.get("SELECT COUNT(*) AS c FROM users")).c),
  );
  assert.equal(
    stats.body.uniqueSignedIn,
    Number(
      (
        await db.get(
          "SELECT COUNT(DISTINCT user_id) AS c FROM login_events WHERE user_id IS NOT NULL",
        )
      ).c,
    ),
  );
  assert.ok(stats.body.today >= 1);

  const post = await handleAdminStats({
    method: "POST",
    headers: { cookie: adminCookie },
    env: process.env,
    requestId: "stats-post",
  });
  assert.equal(post.status, 405);
});

test("Express exposes admin stats only to an admin session", async () => {
  const student = await login("student.one@example.com");
  const admin = await login("owner@example.com", "owner-password-123");
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const anonymous = await fetch(`${base}/api/admin/stats`);
    assert.equal(anonymous.status, 401);

    const asStudent = await fetch(`${base}/api/admin/stats`, {
      headers: { Cookie: cookiesFrom(student).cookie },
    });
    assert.equal(asStudent.status, 403);

    const asAdmin = await fetch(`${base}/api/admin/stats`, {
      headers: { Cookie: cookiesFrom(admin).cookie },
    });
    assert.equal(asAdmin.status, 200);
    const body = await asAdmin.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.totalLogins, "number");
    assert.equal(typeof body.uniqueSignedIn, "number");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("session tokens reject tampering and expiry", async () => {
  const user = await db.get("SELECT * FROM users WHERE email = ?", ["student.one@example.com"]);
  const token = createUserSessionToken(user, process.env);
  const verified = verifySessionToken(token, process.env);
  assert.equal(verified.userId, user.id);
  assert.equal(verified.format, "v2");

  const lastChar = token.slice(-1);
  const tampered = `${token.slice(0, -1)}${lastChar === "0" ? "1" : "0"}`;
  assert.equal(verifySessionToken(tampered, process.env), null);

  const expired = createUserSessionToken(
    user,
    process.env,
    Date.now() - (SESSION_TTL_SECONDS + 60) * 1000,
  );
  assert.equal(verifySessionToken(expired, process.env), null);

  const swappedSecret = { ...process.env, GRANDMASTER_SESSION_SECRET: `${process.env.GRANDMASTER_SESSION_SECRET}-other` };
  assert.equal(verifySessionToken(token, swappedSecret), null);
});

test("students are blocked from admin routes but can use the academy", async () => {
  const signedIn = await login("student.one@example.com");
  const { cookie } = cookiesFrom(signedIn);
  const session = await resolveSession({ cookie }, process.env);
  assert.equal(isAdmin(session), false);

  const denied = fakeRes();
  const blocked = await requireSession({ headers: { cookie } }, denied, process.env, "role-check");
  assert.equal(blocked, null);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, "ROLE_FORBIDDEN");

  const allowed = fakeRes();
  const studentSession = await requireSession(
    { headers: { cookie } },
    allowed,
    process.env,
    "any-check",
    { role: "any" },
  );
  assert.equal(studentSession.role, "student");

  const academy = await handleAcademy({
    method: "GET",
    path: "/courses",
    headers: { cookie },
    env: process.env,
    requestId: "academy-courses",
  });
  assert.equal(academy.status, 200);
  assert.equal(academy.body.courses.length, 1);
  assert.equal(academy.body.courses[0].title, "Trading Basics");

  const anonymous = await handleAcademy({
    method: "GET",
    path: "/courses",
    headers: {},
    env: process.env,
    requestId: "academy-anon",
  });
  assert.equal(anonymous.status, 401);

  const legacyToken = createSessionToken(process.env);
  const legacy = await handleAcademy({
    method: "GET",
    path: "/courses",
    headers: { cookie: `${SESSION_COOKIE_NAME}=${legacyToken}` },
    env: process.env,
    requestId: "academy-legacy",
  });
  assert.equal(legacy.status, 403);
  assert.equal(legacy.body.code, "ACCOUNT_REQUIRED");
});

test("Express rejects a student session on admin routes end to end", async () => {
  const signedIn = await login("student.one@example.com");
  const { cookie } = cookiesFrom(signedIn);
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const adminRoute = await fetch(`${base}/api/health/readiness`, {
      headers: { Cookie: cookie },
    });
    assert.equal(adminRoute.status, 403);
    assert.equal((await adminRoute.json()).code, "ROLE_FORBIDDEN");

    const academyRoute = await fetch(`${base}/api/academy/courses`, {
      headers: { Cookie: cookie },
    });
    assert.equal(academyRoute.status, 200);
    assert.equal((await academyRoute.json()).courses.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rate limits and per-account lockout stop repeated attempts", async () => {
  resetAuthRateLimits();
  const limited = { ...process.env, AUTH_RATE_LIMIT_PER_MINUTE: "2" };
  const start = Date.now();
  assert.equal(checkAuthRateLimit("rate-client", limited, start).allowed, true);
  assert.equal(checkAuthRateLimit("rate-client", limited, start + 1).allowed, true);
  const blocked = checkAuthRateLimit("rate-client", limited, start + 2);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 60);
  assert.equal(checkAuthRateLimit("rate-client", limited, start + 61_000).allowed, true);

  assert.equal((await signup("lockout@example.com")).status, 201);
  const moment = Date.now();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await authenticateUser(
      { email: "lockout@example.com", password: "wrong-pass" },
      process.env,
      moment,
    );
    assert.equal(result.status, 401);
  }
  const locked = await authenticateUser(
    { email: "lockout@example.com", password: "student-password-1" },
    process.env,
    moment,
  );
  assert.equal(locked.status, 429);
  assert.equal(locked.code, "AUTH_LOCKED");
  assert.ok(locked.retryAfter > 0);
});

test("password reset tokens are single use, expiring and version-bumping", async () => {
  const email = "reset.learner@example.com";
  assert.equal((await signup(email)).status, 201);

  const before = await login(email);
  const { cookie } = cookiesFrom(before);
  assert.ok(await resolveSession({ cookie }, process.env));

  const request = await createPasswordReset(email, process.env);
  assert.ok(request.devToken);

  const used = await consumePasswordReset(request.devToken, "replacement-password-1", process.env);
  assert.equal(used.ok, true);

  const reused = await consumePasswordReset(request.devToken, "another-password-x1", process.env);
  assert.equal(reused.code, "RESET_INVALID");

  // The reset bumped session_version, so the earlier session is dead.
  assert.equal(await resolveSession({ cookie }, process.env), null);

  const relogin = await login(email, "replacement-password-1");
  assert.equal(relogin.status, 200);

  const expiring = await createPasswordReset(email, process.env);
  assert.ok(expiring.devToken);
  const tokenHash = createHash("sha256").update(expiring.devToken).digest("hex");
  await db.run("UPDATE password_resets SET expires_at = ? WHERE token_hash = ?", [
    new Date(Date.now() - 1000).toISOString(),
    tokenHash,
  ]);
  const expired = await consumePasswordReset(expiring.devToken, "expired-password-1", process.env);
  assert.equal(expired.code, "RESET_INVALID");

  assert.equal((await signup("prod.reset@example.com")).status, 201);
  const production = await createPasswordReset("prod.reset@example.com", {
    ...process.env,
    NODE_ENV: "production",
  });
  assert.equal(production.devToken, undefined);

  const unknown = await handleForgotPassword({
    method: "POST",
    headers: {},
    body: { email: "missing.account@example.com" },
    env: process.env,
    clientKey: nextId("forgot-client"),
    requestId: "forgot-unknown",
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.devResetToken, undefined);

  const resetRoute = await handleResetPassword({
    method: "POST",
    headers: {},
    body: { token: "not-a-real-token", newPassword: "whatever-pass-1" },
    env: process.env,
    clientKey: nextId("reset-client"),
    requestId: "reset-bad-token",
  });
  assert.equal(resetRoute.status, 400);
  assert.equal(resetRoute.body.code, "RESET_INVALID");
});

test("password change requires the current password and invalidates old sessions", async () => {
  const email = "change.learner@example.com";
  assert.equal((await signup(email)).status, 201);
  const signedIn = await login(email);
  const { cookie, csrf } = cookiesFrom(signedIn);

  const noCsrf = await handleChangePassword({
    method: "POST",
    headers: { cookie },
    body: { currentPassword: "student-password-1", newPassword: "changed-password-1" },
    env: process.env,
    requestId: "change-no-csrf",
  });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.code, "CSRF_INVALID");

  const wrongCurrent = await handleChangePassword({
    method: "POST",
    headers: { cookie, "x-csrf-token": csrf },
    body: { currentPassword: "not-the-password", newPassword: "changed-password-1" },
    env: process.env,
    requestId: "change-wrong-current",
  });
  assert.equal(wrongCurrent.status, 401);

  const changed = await handleChangePassword({
    method: "POST",
    headers: { cookie, "x-csrf-token": csrf },
    body: { currentPassword: "student-password-1", newPassword: "changed-password-1" },
    env: process.env,
    requestId: "change-ok",
  });
  assert.equal(changed.status, 200);

  assert.equal(await resolveSession({ cookie }, process.env), null);
  assert.equal((await login(email, "student-password-1")).status, 401);
  assert.equal((await login(email, "changed-password-1")).status, 200);
});

test("account deletion checks the password and removes personal rows", async () => {
  const email = "delete.learner@example.com";
  assert.equal((await signup(email)).status, 201);
  const signedIn = await login(email);
  const { cookie, csrf } = cookiesFrom(signedIn);
  const userId = signedIn.body.user.id;

  await completeLesson(db, userId, SEED_IDS.lessons[0]);
  await submitQuizAttempt(db, userId, SEED_IDS.quiz, Object.fromEntries(SEED_IDS.questions.map((id) => [id, 1])));

  const before = Number(
    (await db.get("SELECT COUNT(*) AS c FROM audit_log WHERE user_id IS NULL AND action = 'signup'")).c,
  );

  const wrong = await handleDeleteAccount({
    method: "DELETE",
    headers: { cookie, "x-csrf-token": csrf },
    body: { password: "not-the-password" },
    env: process.env,
    requestId: "delete-wrong",
  });
  assert.equal(wrong.status, 401);

  const deleted = await handleDeleteAccount({
    method: "DELETE",
    headers: { cookie, "x-csrf-token": csrf },
    body: { password: "student-password-1" },
    env: process.env,
    requestId: "delete-ok",
  });
  assert.equal(deleted.status, 200);

  assert.equal(await db.get("SELECT id FROM users WHERE id = ?", [userId]), undefined);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM progress WHERE user_id = ?", [userId])).c, 0);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM quiz_attempts WHERE user_id = ?", [userId])).c, 0);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM password_resets WHERE user_id = ?", [userId])).c, 0);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM login_events WHERE user_id = ?", [userId])).c, 0);

  // The security trail survives, detached from the deleted identity.
  const afterCount = Number(
    (await db.get("SELECT COUNT(*) AS c FROM audit_log WHERE user_id IS NULL AND action = 'signup'")).c,
  );
  assert.equal(afterCount, before + 1);

  const relogin = await login(email);
  assert.equal(relogin.status, 401);
});

test("quiz answers stay server-side and scoring is computed on the server", async () => {
  const email = "quiz.learner@example.com";
  assert.equal((await signup(email)).status, 201);
  const userId = (await login(email)).body.user.id;

  const quiz = await getQuizForClient(db, SEED_IDS.quiz);
  assert.equal(quiz.questions.length, 5);
  for (const question of quiz.questions) {
    assert.equal(question.options.length, 4);
    assert.equal(Object.prototype.hasOwnProperty.call(question, "correctIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(question, "explanation"), false);
  }

  const allCorrect = Object.fromEntries(SEED_IDS.questions.map((id) => [id, 1]));
  const perfect = await submitQuizAttempt(db, userId, SEED_IDS.quiz, allCorrect);
  assert.equal(perfect.score, 5);
  assert.equal(perfect.total, 5);
  assert.equal(perfect.percent, 100);
  assert.equal(perfect.passed, true);
  for (const result of perfect.results) {
    assert.equal(result.correct, true);
    assert.equal(result.correctIndex, 1);
    assert.ok(result.explanation.length > 10);
  }

  const allWrong = Object.fromEntries(SEED_IDS.questions.map((id) => [id, 0]));
  const failed = await submitQuizAttempt(db, userId, SEED_IDS.quiz, allWrong);
  assert.equal(failed.score, 0);
  assert.equal(failed.percent, 0);
  assert.equal(failed.passed, false);
  for (const result of failed.results) {
    assert.equal(result.correct, false);
    assert.equal(result.chosenIndex, 0);
    assert.equal(result.correctIndex, 1);
    assert.ok(result.explanation.length > 10);
  }

  const malformed = await submitQuizAttempt(db, userId, SEED_IDS.quiz, { [SEED_IDS.questions[0]]: 99 });
  assert.equal(malformed.score, 0);
  assert.equal(malformed.results[0].chosenIndex, null);

  const attempts = await listAttempts(db, userId, SEED_IDS.quiz);
  assert.equal(attempts.length, 3);
  assert.equal(attempts.every((attempt) => attempt.total === 5), true);
});

test("lesson completion is idempotent and progress reports percent and streak", async () => {
  const email = "progress.learner@example.com";
  assert.equal((await signup(email)).status, 201);
  const userId = (await login(email)).body.user.id;

  const first = await completeLesson(db, userId, SEED_IDS.lessons[0]);
  assert.equal(first.completed, true);
  const again = await completeLesson(db, userId, SEED_IDS.lessons[0]);
  assert.equal(again.completedAt, first.completedAt);

  let progress = await getProgress(db, userId, new Date());
  assert.equal(progress.completedLessons, 1);
  assert.equal(progress.totalLessons, 3);
  assert.equal(progress.percent, 33);
  assert.equal(progress.streakDays, 1);
  assert.ok(progress.lastActivity);

  const course = await getCourse(db, SEED_IDS.course, userId);
  assert.equal(course.lessons.length, 3);
  assert.equal(course.lessons[0].completed, true);
  assert.equal(course.percent, 33);

  await completeLesson(db, userId, SEED_IDS.lessons[1]);
  await completeLesson(db, userId, SEED_IDS.lessons[2]);
  progress = await getProgress(db, userId, new Date());
  assert.equal(progress.completedLessons, 3);
  assert.equal(progress.percent, 100);
  assert.equal(progress.courses[0].percent, 100);

  const stale = await getProgress(db, userId, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
  assert.equal(stale.streakDays, 0);
});

test("academy mutations require a matching CSRF token", async () => {
  const email = "csrf.learner@example.com";
  assert.equal((await signup(email)).status, 201);
  const { cookie, csrf } = cookiesFrom(await login(email));

  const missing = await handleAcademy({
    method: "POST",
    path: `/lessons/${SEED_IDS.lessons[1]}/complete`,
    headers: { cookie },
    env: process.env,
    requestId: "csrf-missing",
  });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.code, "CSRF_INVALID");

  const mismatched = await handleAcademy({
    method: "POST",
    path: `/lessons/${SEED_IDS.lessons[1]}/complete`,
    headers: { cookie, "x-csrf-token": createCsrfToken() },
    env: process.env,
    requestId: "csrf-mismatch",
  });
  assert.equal(mismatched.status, 403);

  const good = await handleAcademy({
    method: "POST",
    path: `/lessons/${SEED_IDS.lessons[1]}/complete`,
    headers: { cookie, "x-csrf-token": csrf },
    env: process.env,
    requestId: "csrf-good",
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.completed, true);

  const attempts = await handleAcademy({
    method: "POST",
    path: `/quizzes/${SEED_IDS.quiz}/attempts`,
    headers: { cookie, "x-csrf-token": csrf },
    body: { answers: Object.fromEntries(SEED_IDS.questions.map((id) => [id, 1])) },
    env: process.env,
    requestId: "quiz-submit",
  });
  assert.equal(attempts.status, 201);
  assert.equal(attempts.body.attempt.score, 5);
});

test("signup persists a student only once and never as an admin", async () => {
  const result = await signupUser(
    { email: "role.check@example.com", password: "student-password-9" },
    process.env,
  );
  assert.equal(result.ok, true);
  assert.equal(result.user.role, "student");
  const stored = await db.get("SELECT role FROM users WHERE email = ?", ["role.check@example.com"]);
  assert.equal(stored.role, "student");
});
