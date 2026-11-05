import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-mission-auth-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_SESSION_SECRET = "mission-auth-secret-0123456789abcdef0123456789";
process.env.ADMIN_EMAIL = "admin@grandmaster.local";
process.env.ADMIN_PASSWORD = "admin-password-123";
process.env.AUTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.BCRYPT_ROUNDS = "4";
process.env.GRANDMASTER_LOG_SILENT = "1";

const { closeDatabase, getDatabase } = await import("../lib/db/index.js");
const { sendConfirm, sendWelcome, sendOwnerAlert, formatWelcomeMessage } = await import(
  "../lib/auth/email.js"
);
const {
  signupUser,
  getPendingUsers,
  approveOrRejectUser,
} = await import("../lib/auth/accounts.js");
const { handleVerifyEmail, handleResendVerify } = await import("../lib/auth/routes.js");

const db = getDatabase(process.env);

after(async () => {
  await closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("email helper produces expected welcome message and log payloads", async () => {
  const formatted = formatWelcomeMessage("Taimoor");
  assert.match(formatted, /Assalam-o-Alaikum Taimoor!/);
  assert.match(formatted, /Real Trading BANNED/);
  assert.match(formatted, /Roz MAX 10 Token/);

  const confirmRes = await sendConfirm("test@example.com", "tok-123", { displayName: "Taimoor" });
  assert.equal(confirmRes.ok, true);
  assert.match(confirmRes.confirmUrl, /verify-email\?token=tok-123/);

  const welcomeRes = await sendWelcome("test@example.com", { displayName: "Taimoor" });
  assert.equal(welcomeRes.ok, true);
  assert.match(welcomeRes.message, /Taimoor/);

  const alertRes = await sendOwnerAlert("new_signup", { id: "u-1", email: "test@example.com" });
  assert.equal(alertRes.ok, true);
  assert.equal(alertRes.ownerEmail, "admin@grandmaster.local");
});

test("full flow: Signup -> Email Confirm -> PENDING_APPROVAL -> Owner Approve -> ACTIVE -> Welcome", async () => {
  // 1. Signup user
  const signupResult = await signupUser(
    { email: "learner.next@example.com", password: "learner-pass-123", displayName: "Sher" },
    process.env,
  );
  assert.equal(signupResult.ok, true);
  assert.equal(signupResult.status, 201);
  assert.ok(signupResult.emailToken);
  assert.equal(signupResult.user.status, "PENDING_APPROVAL");
  assert.equal(signupResult.user.emailVerified, 0);

  // 2. Pending users list contains this user
  const pendingBefore = await getPendingUsers(process.env);
  assert.ok(pendingBefore.some((u) => u.email === "learner.next@example.com"));

  // 3. Email verification using token
  const verifyRes = await handleVerifyEmail({
    method: "GET",
    query: { token: signupResult.emailToken },
    env: process.env,
    requestId: "req-verify-1",
  });
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.body.ok, true);
  assert.equal(verifyRes.body.user.emailVerified, 1);
  assert.equal(verifyRes.body.user.status, "PENDING_APPROVAL");

  // Re-verify with same token should fail as expired / used
  const reVerify = await handleVerifyEmail({
    method: "GET",
    query: { token: signupResult.emailToken },
    env: process.env,
    requestId: "req-verify-re",
  });
  assert.equal(reVerify.status, 400);

  // 4. Resend verify functionality
  const userRow = await db.get("SELECT id FROM users WHERE email = 'learner.next@example.com'");
  await db.run("UPDATE users SET email_verified = 0 WHERE id = ?", [userRow.id]);

  const resendRes = await handleResendVerify({
    method: "POST",
    headers: {},
    body: { email: "learner.next@example.com" },
    env: process.env,
    clientKey: "client-resend",
    requestId: "req-resend-1",
  });
  assert.equal(resendRes.status, 200);
  assert.ok(resendRes.body.devToken);

  // 5. Owner approves user
  const approveRes = await approveOrRejectUser("admin-1", userRow.id, "ACTIVE", process.env);
  assert.equal(approveRes.ok, true);
  assert.equal(approveRes.user.status, "ACTIVE");

  // User is no longer in pending list
  const pendingAfter = await getPendingUsers(process.env);
  assert.equal(pendingAfter.some((u) => u.id === userRow.id), false);

  // Reject / ban test
  const signupResult2 = await signupUser(
    { email: "learner.reject@example.com", password: "learner-pass-123" },
    process.env,
  );
  const rejectRes = await approveOrRejectUser("admin-1", signupResult2.user.id, "REJECTED", process.env);
  assert.equal(rejectRes.ok, true);
  assert.equal(rejectRes.user.status, "BANNED");
});
