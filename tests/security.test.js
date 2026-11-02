import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-security-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "security-control-token-1234567890";
process.env.GRANDMASTER_UI_PASSWORD = "security-ui-password-123";
process.env.GRANDMASTER_SESSION_SECRET =
  "security-session-secret-0123456789abcdef0123456789";
process.env.AUTH_RATE_LIMIT_PER_MINUTE = "100";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.GRANDMASTER_RATE_LIMIT_PER_MINUTE = "1000";
process.env.AI_RATE_LIMIT_PER_MINUTE = "2";
process.env.RATE_LIMIT_PER_MINUTE = "2";
process.env.CORS_ALLOWED_ORIGINS =
  "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5174";
process.env.AI_PROVIDERS = "gemini:test-model";
process.env.GEMINI_API_KEY = "";
process.env.AI_API_KEY = "";
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

const { handleV1, resetRateLimits } = await import("../lib/api/v1.js");
const {
  applyCors,
  isOriginAllowed,
  getAllowedOrigins,
  isVercelDeploymentOrigin,
  isSameOriginRequest,
} = await import("../lib/cors.js");
const { providerHealthLabel } = await import("../lib/aiProviders.js");
const chatHandler = (await import("../api/chat.js")).default;
const { createApp } = await import("../server/server.js");
const { memoryStore } = await import("../lib/memory/memoryStore.js");
const { submitTask } = await import("../lib/orchestrator/mastermind.js");
const {
  createSessionToken,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} = await import("../lib/auth/session.js");
const { resetAuthRateLimits } = await import("../lib/auth/routes.js");
const { createChatRateLimiter, MAX_CHAT_CLIENTS } = await import(
  "../lib/chatRateLimit.js"
);
const { WINDOW_MS } = await import("../lib/rateLimitWindow.js");
const { clientKeyFrom } = await import("../lib/vercelHttp.js");

const TOKEN = "security-control-token-1234567890";
const authorized = { "x-grandmaster-token": TOKEN };
const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";
let sequence = 0;

function sessionCookie() {
  return `${SESSION_COOKIE_NAME}=${createSessionToken(process.env)}`;
}

async function call(method, requestPath, options = {}) {
  sequence += 1;
  return handleV1({
    method,
    path: requestPath,
    query: options.query || {},
    headers: {
      "x-request-id": `security-request-${sequence}`,
      ...(options.headers || {}),
    },
    body: options.body,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl,
    clientKey: options.clientKey || `security-client-${sequence}`,
  });
}

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    writableEnded: false,
  };
  res.setHeader = (key, value) => {
    res.headers[String(key).toLowerCase()] = value;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    res.writableEnded = true;
    return res;
  };
  res.end = () => {
    res.writableEnded = true;
    return res;
  };
  const listeners = new Map();
  res.on = (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
  };
  res.removeListener = (name, fn) => listeners.get(name)?.delete(fn);
  res.emitClose = () => {
    for (const fn of [...(listeners.get("close") || [])]) fn();
  };
  return res;
}

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("every consequential route rejects missing and invalid control tokens", async () => {
  resetRateLimits();
  const protectedRoutes = [
    ["GET", "/audit"],
    ["GET", "/tasks"],
    ["POST", "/tasks", { request: "prefers short answers" }],
    ["GET", `/tasks/${UNKNOWN_ID}`],
    ["POST", `/tasks/${UNKNOWN_ID}/run`, {}],
    ["GET", "/notifications"],
    ["POST", `/tasks/${UNKNOWN_ID}/approve`, {}],
    ["POST", `/tasks/${UNKNOWN_ID}/cancel`, {}],
    ["POST", `/tasks/${UNKNOWN_ID}/retry`, {}],
    ["GET", "/memory"],
    ["POST", "/memory", { text: "prefers short answers" }],
    ["PATCH", "/memory/unknown-id", { text: "changed" }],
    ["DELETE", "/memory/unknown-id"],
    ["POST", "/integrations/whatsapp_business/test", {}],
  ];

  for (const [method, route, body] of protectedRoutes) {
    const denied = await call(method, route, { body });
    assert.equal(denied.status, 403, `${method} ${route} must be protected`);
    assert.equal(denied.body.error.code, "APPROVAL_REQUIRED");

    const invalid = await call(method, route, {
      body,
      headers: { "x-grandmaster-token": "invalid-token-0000000000" },
    });
    assert.equal(invalid.status, 403, `${method} ${route} must reject a bad token`);
    assert.equal(invalid.body.error.code, "INVALID_CONTROL_TOKEN");

    const allowed = await call(method, route, { body, headers: authorized });
    assert.notEqual(allowed.status, 403, `${method} ${route} must accept a valid token`);
  }
});

test("missing server control authority returns 503, not silent access", async () => {
  const env = { ...process.env, GRANDMASTER_CONTROL_TOKEN: "" };
  for (const [method, route, body] of [
    ["GET", "/audit"],
    ["GET", "/tasks"],
    ["POST", "/tasks", { request: "blocked without authority" }],
    ["GET", "/notifications"],
  ]) {
    const response = await call(method, route, { env, body });
    assert.equal(response.status, 503, `${method} ${route} must fail closed`);
    assert.equal(response.body.error.code, "APPROVAL_AUTHORITY_NOT_CONFIGURED");
  }
});

test("approval-required action is blocked, cannot be approved twice, and never performs externally", async () => {
  resetRateLimits();
  const deniedCreate = await call("POST", "/tasks", {
    body: { request: "publish this post on instagram now" },
  });
  assert.equal(deniedCreate.status, 403);
  assert.equal(deniedCreate.body.error.code, "APPROVAL_REQUIRED");

  const created = await call("POST", "/tasks", {
    headers: authorized,
    body: { request: "publish this post on instagram now", idempotencyKey: "security-approval-1" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.task.status, "AWAITING_APPROVAL");
  const taskId = created.body.data.task.id;

  const approval = created.body.data.task.approval;
  assert.ok(approval.id);
  assert.equal(approval.taskId, taskId);
  assert.equal(approval.agentId, "social_media");
  assert.equal(approval.action, "external_action");
  assert.equal(approval.risk, "high");
  assert.ok(approval.requestedAt);
  assert.equal(approval.decidedAt, null);
  assert.equal(approval.decision, null);
  assert.equal(approval.decidedBy, null);

  const runDenied = await call("POST", `/tasks/${taskId}/run`);
  assert.equal(runDenied.status, 403);
  assert.equal(runDenied.body.error.code, "APPROVAL_REQUIRED");

  const runBlocked = await call("POST", `/tasks/${taskId}/run`, {
    headers: authorized,
  });
  assert.equal(runBlocked.status, 409);
  assert.equal(runBlocked.body.error.code, "APPROVAL_REQUIRED");

  const approved = await call("POST", `/tasks/${taskId}/approve`, {
    headers: authorized,
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.task.status, "QUEUED");
  assert.equal(approved.body.data.task.approval.decision, "approved");
  assert.equal(approved.body.data.task.approval.decidedBy, "control-token");
  assert.ok(approved.body.data.task.approval.decidedAt);

  const secondApproval = await call("POST", `/tasks/${taskId}/approve`, {
    headers: authorized,
  });
  assert.equal(secondApproval.status, 409);
  assert.equal(secondApproval.body.error.code, "INVALID_TRANSITION");

  const run = await call("POST", `/tasks/${taskId}/run`, {
    headers: authorized,
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.data.task.status, "FAILED");
  assert.equal(run.body.data.task.result, null);
  assert.equal(run.body.data.task.error.code, "EXTERNAL_ACTION_NOT_IMPLEMENTED");
});

test("task-based memory writes require server authorization and cannot be forged", async () => {
  resetRateLimits();
  const before = memoryStore.stats().total;
  const marker = "security-memory-bypass-marker";

  const denied = await call("POST", "/tasks", {
    body: {
      request: `remember: ${marker}-api`,
      authorized: true,
      authorization: { authorized: true },
    },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "APPROVAL_REQUIRED");

  const forged = await submitTask({
    request: `remember: ${marker}-internal`,
    agentId: "memory",
    env: process.env,
    authorization: { authorized: true },
  });
  assert.equal(forged.task.status, "FAILED");
  assert.equal(forged.task.error.code, "MEMORY_AUTHORIZATION_REQUIRED");

  const missing = await submitTask({
    request: `remember: ${marker}-missing`,
    agentId: "memory",
    env: process.env,
  });
  assert.equal(missing.task.status, "FAILED");
  assert.equal(missing.task.error.code, "MEMORY_AUTHORIZATION_REQUIRED");

  assert.equal(memoryStore.stats().total, before);
  assert.equal(memoryStore.list({ query: marker, limit: 50 }).length, 0);
});

test("public endpoints disclose no private task or memory content", async () => {
  resetRateLimits();
  const taskMarker = "public-task-leak-marker";
  const memoryMarker = "public-memory-leak-marker";

  const task = await call("POST", "/tasks", {
    headers: authorized,
    body: {
      request: `publish this post on instagram now ${taskMarker}`,
      idempotencyKey: "security-public-leak-1",
    },
  });
  assert.equal(task.status, 201);
  assert.equal(task.body.data.task.status, "AWAITING_APPROVAL");

  const memory = await call("POST", "/memory", {
    headers: authorized,
    body: { text: memoryMarker, category: "project" },
  });
  assert.equal(memory.status, 201);

  for (const route of [
    "/status",
    "/agents",
    "/integrations",
    "/security/posture",
    "/agents/social_media",
  ]) {
    const response = await call("GET", route);
    assert.equal(response.status, 200, `${route} must remain public`);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes(taskMarker), false, `${route} must not expose task text`);
    assert.equal(
      serialized.includes(memoryMarker),
      false,
      `${route} must not expose memory content`,
    );
    assert.equal(serialized.includes(TOKEN), false, `${route} must not expose the token`);
  }

  const detail = await call("GET", "/agents/social_media");
  assert.ok(Array.isArray(detail.body.data.recentTasks));
  assert.ok(detail.body.data.recentTasks.length > 0);
  assert.ok(detail.body.data.recentTasks.every((item) => item.request === undefined));
});

test("locked financial actions remain blocked even with a valid control token", async () => {
  resetRateLimits();
  const before = await call("GET", "/tasks", { headers: authorized });
  const response = await call("POST", "/tasks", {
    headers: authorized,
    body: { request: "withdraw funds from my trading account" },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "ACTION_LOCKED");
  assert.equal(response.body.details.plan.locked, true);

  const afterTasks = await call("GET", "/tasks", { headers: authorized });
  assert.equal(afterTasks.body.data.tasks.length, before.body.data.tasks.length);
});

test("malformed, wrong-type and oversized bodies are rejected safely", async () => {
  const malformed = await call("POST", "/tasks", {
    headers: authorized,
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "INVALID_JSON");

  const arrayBody = await call("POST", "/tasks", {
    headers: authorized,
    body: [],
  });
  assert.equal(arrayBody.status, 400);
  assert.equal(arrayBody.body.error.code, "INVALID_BODY");

  const numberBody = await call("POST", "/mastermind/plan", { body: 42 });
  assert.equal(numberBody.status, 400);
  assert.equal(numberBody.body.error.code, "INVALID_BODY");

  const oversized = await call("POST", "/mastermind/plan", {
    headers: { "content-length": String(65 * 1024) },
    body: { request: "plan a small task" },
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, "REQUEST_TOO_LARGE");
});

test("CORS allow-list rejects unlisted origins and never accepts a wildcard", async () => {
  assert.equal(isOriginAllowed("http://localhost:5173"), true);
  assert.equal(isOriginAllowed("http://localhost:5174"), true);
  assert.equal(isOriginAllowed("http://127.0.0.1:5174"), true);
  assert.equal(isOriginAllowed("https://evil.example"), false);
  assert.equal(
    isOriginAllowed("https://evil.example", {
      ...process.env,
      CORS_ALLOWED_ORIGINS: "*",
      ALLOWED_ORIGINS: "*",
    }),
    false,
  );
  const wildcardEnvs = [
    { ...process.env, CORS_ALLOWED_ORIGINS: "*", ALLOWED_ORIGINS: "*" },
    { ...process.env, CORS_ALLOWED_ORIGINS: "http://localhost:5174,*", ALLOWED_ORIGINS: "" },
    { ...process.env, CORS_ALLOWED_ORIGINS: "*.example.com", ALLOWED_ORIGINS: "" },
  ];
  for (const env of wildcardEnvs) {
    assert.ok(!getAllowedOrigins(env).includes("*"));
    assert.equal(getAllowedOrigins(env).some((origin) => origin.includes("*")), false);
  }

  // Dev defaults apply only outside production; production without an explicit
  // list fails closed instead of silently allowing localhost.
  const devOrigins = getAllowedOrigins({ NODE_ENV: "development", CORS_ALLOWED_ORIGINS: "" });
  assert.ok(devOrigins.includes("http://localhost:5174"));
  assert.ok(devOrigins.includes("http://127.0.0.1:5174"));
  assert.ok(devOrigins.includes("http://localhost:5173"));
  assert.equal(
    isOriginAllowed("http://localhost:5174", { NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "" }),
    false,
  );
  assert.deepEqual(
    getAllowedOrigins({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "" }),
    [],
  );

  // Explicit env list wins over dev defaults and entries are normalised.
  assert.deepEqual(
    getAllowedOrigins({
      NODE_ENV: "development",
      CORS_ALLOWED_ORIGINS: " http://localhost:5174/ , http://127.0.0.1:5174 ",
    }),
    ["http://localhost:5174", "http://127.0.0.1:5174"],
  );

  const deniedRes = fakeRes();
  const answered = applyCors(
    { method: "GET", headers: { origin: "https://evil.example" } },
    deniedRes,
  );
  assert.equal(answered, true);
  assert.equal(deniedRes.statusCode, 403);
});

// Preview hostnames come from `vercel ls`: <project>-<hash>-<team>.vercel.app, so
// no static CORS_ALLOWED_ORIGINS entry can ever list them.
const PREVIEW_ONLY_ENV = {
  NODE_ENV: "production",
  VERCEL: "1",
  CORS_ALLOWED_ORIGINS: "",
  ALLOWED_ORIGINS: "",
};
const OWN_PREVIEW = "https://grandmaster-digital-etmmzfm8r-businesskids62-4987.vercel.app";

test("this project's Vercel previews are allowed while other tenants and spoofs stay denied", () => {
  const allowed = [
    OWN_PREVIEW,
    "https://grandmaster-digital-42g474pfo-businesskids62-4987.vercel.app",
    "https://grandmaster-digital-git-phase1-academy-businesskids62-4987.vercel.app",
  ];
  for (const origin of allowed) {
    assert.equal(isOriginAllowed(origin, PREVIEW_ONLY_ENV), true, `${origin} is our own preview`);
  }

  const denied = [
    "https://grandmaster-digital-etmmzfm8r-evil-team-9999.vercel.app",
    "https://someone-else-scope-businesskids62-49877.vercel.app",
    "https://grandmaster-digital-hub.vercel.app.evil.test",
    "https://attacker.test/grandmaster-digital-x-businesskids62-4987.vercel.app",
    "https://evil.vercel.app@attacker.test",
    "http://grandmaster-digital-x-businesskids62-4987.vercel.app",
    "https://grandmaster-digital-x-businesskids62-4987.vercel.app:4443",
    "https://grandmaster-digital-x-businesskids62-4987.vercel.app/pwned",
    "https://grandmaster-digital-x-businesskids62-4987.vercel.app?x=1",
    "https://vercel.app",
    "https://evil-localhost:3000.test",
    "http://localhost.evil.test",
    "http://127.0.0.1:5173.evil.test",
  ];
  for (const origin of denied) {
    assert.equal(isOriginAllowed(origin, PREVIEW_ONLY_ENV), false, `${origin} must stay denied`);
  }

  // A bare `.vercel.app` suffix is never trust on its own: credentialed CORS must
  // not extend to every deployment on the platform.
  assert.equal(
    isVercelDeploymentOrigin("https://attacker-project.vercel.app", PREVIEW_ONLY_ENV),
    false,
  );
  // Production without an allow-list still fails closed for its own alias, which
  // is not a deployment-shaped hostname.
  assert.equal(
    isOriginAllowed("https://grandmaster-digital-hub.vercel.app", PREVIEW_ONLY_ENV),
    false,
  );

  // Port 3000 joins the dev defaults, and only outside production.
  assert.equal(
    isOriginAllowed("http://localhost:3000", {
      NODE_ENV: "development",
      CORS_ALLOWED_ORIGINS: "",
    }),
    true,
  );
  assert.equal(
    isOriginAllowed("http://localhost:3000", PREVIEW_ONLY_ENV),
    false,
    "dev origins must not leak into production",
  );
});

test("a deployment answers its own page instead of 403-ing its login POST", () => {
  const alias = "https://grandmaster-digital-hub.vercel.app";
  const emptyAllowList = { NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "" };

  // Browsers send Origin on same-origin POSTs too, so an exact-only allow-list
  // makes a deployment reject the page it served. Host equality is the fix.
  const selfRes = fakeRes();
  const selfAnswered = applyCors(
    { method: "POST", headers: { origin: alias, host: "grandmaster-digital-hub.vercel.app" } },
    selfRes,
    emptyAllowList,
  );
  assert.equal(selfAnswered, false, "same-origin request reaches its handler");
  assert.equal(selfRes.headers["access-control-allow-origin"], alias);
  assert.equal(selfRes.headers["access-control-allow-credentials"], "true");

  // Exact host equality only: the alias origin against a different host is a
  // cross-origin request and still fails closed.
  const crossRes = fakeRes();
  const crossAnswered = applyCors(
    { method: "POST", headers: { origin: alias, host: "other-app.vercel.app" } },
    crossRes,
    emptyAllowList,
  );
  assert.equal(crossAnswered, true);
  assert.equal(crossRes.statusCode, 403);

  // A host header with a port, path or credentials appended is not the same host.
  assert.equal(
    isSameOriginRequest({ headers: { host: "grandmaster-digital-hub.vercel.app:8443" } }, alias),
    false,
  );
});

test("preflight admits every header the SPA actually sends", () => {
  const res = fakeRes();
  const answered = applyCors(
    { method: "OPTIONS", headers: { origin: OWN_PREVIEW, host: OWN_PREVIEW.slice(8) } },
    res,
    PREVIEW_ONLY_ENV,
  );
  assert.equal(answered, true);
  assert.equal(res.statusCode, 204, "preflight is answered without reaching a handler");
  assert.equal(res.body, null);
  assert.equal(res.headers["access-control-allow-origin"], OWN_PREVIEW);
  assert.equal(res.headers.vary, "Origin");

  // src/academy/api.js sends X-CSRF-Token, AcademyApp.jsx sends x-gm-surface and
  // BrowserOperator.jsx sends X-Grandmaster-Operator-Token; any omission here
  // fails the browser preflight before the request is ever made.
  const headers = res.headers["access-control-allow-headers"];
  for (const name of [
    "Content-Type",
    "Authorization",
    "X-CSRF-Token",
    "X-Grandmaster-Token",
    "X-Grandmaster-Operator-Token",
    "X-Gm-Surface",
    "X-Request-Id",
  ]) {
    assert.ok(headers.includes(name), `allow-headers must list ${name}`);
  }
  assert.equal(headers.includes("*"), false, "no wildcard with credentials enabled");
  assert.ok(res.headers["access-control-allow-methods"].includes("POST"));
});

test("Express app enforces auth, CORS, body limits and honest health labels end to end", async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = sessionCookie();

  try {
    const denied = await fetch(`${base}/api/health`, {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(denied.status, 403);

    const allowed = await fetch(`${base}/api/health`, {
      headers: { Origin: "http://localhost:5173" },
    });
    assert.equal(allowed.status, 200);
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "http://localhost:5173",
    );
    assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
    assert.ok(allowed.headers.get("content-security-policy"));
    const viteLatest = await fetch(`${base}/api/health`, {
      headers: { Origin: "http://localhost:5174" },
    });
    assert.equal(viteLatest.status, 200);
    assert.equal(
      viteLatest.headers.get("access-control-allow-origin"),
      "http://localhost:5174",
    );

    const health = await allowed.json();
    assert.equal(health.ok, true);
    assert.equal(health.status, "alive");
    assert.equal(health.service, "grandmaster-digital-hub");
    assert.equal(Object.prototype.hasOwnProperty.call(health, "checks"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(health, "providerStatus"), false);

    const wrongMethod = await fetch(`${base}/api/health`, { method: "POST" });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "GET, HEAD");

    // Private readiness and provider routes require the signed session.
    const readinessDenied = await fetch(`${base}/api/health/readiness`);
    assert.equal(readinessDenied.status, 401);
    assert.equal((await readinessDenied.json()).code, "AUTH_REQUIRED");

    const providersDenied = await fetch(`${base}/api/ai/providers`);
    assert.equal(providersDenied.status, 401);

    const readiness = await fetch(`${base}/api/health/readiness`, {
      headers: { Cookie: cookie },
    });
    assert.equal(readiness.status, 200);
    const readinessBody = await readiness.json();
    assert.equal(readinessBody.status, "DEGRADED");
    assert.equal(readinessBody.checks.controlAuthority.status, "pass");
    assert.equal(readinessBody.checks.aiProvider.configured, false);
    assert.ok(readinessBody.reasonCodes.includes("AI_PROVIDER_NOT_CONFIGURED"));

    // Sign-in flow: wrong password 401, right password sets the HttpOnly cookie.
    const badLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong-password-value" }),
    });
    assert.equal(badLogin.status, 401);
    assert.equal((await badLogin.json()).code, "AUTH_INVALID_CREDENTIALS");

    const goodLogin = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "security-ui-password-123" }),
    });
    assert.equal(goodLogin.status, 200);
    const setCookie = goodLogin.headers.get("set-cookie") || "";
    assert.ok(setCookie.includes("gm_session="));
    assert.ok(setCookie.toLowerCase().includes("httponly"));
    assert.ok(setCookie.toLowerCase().includes("samesite=strict"));

    const session = await fetch(`${base}/api/auth/session`, {
      headers: { Cookie: cookie },
    });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).authenticated, true);

    const sessionDenied = await fetch(`${base}/api/auth/session`);
    assert.equal(sessionDenied.status, 401);

    const oversized = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(70 * 1024) }),
    });
    assert.equal(oversized.status, 413);

    const chatDenied = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    assert.equal(chatDenied.status, 401);

    const v1Denied = await fetch(`${base}/api/v1/memory`);
    assert.equal(v1Denied.status, 401);

    const chatStatuses = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ message: `hello ${index}` }),
      });
      chatStatuses.push(response.status);
    }
    assert.equal(chatStatuses.slice(0, 2).every((status) => status === 503), true);
    assert.equal(chatStatuses[2], 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Vercel chat adapter requires a session, rejects oversized bodies and rate limits", async () => {
  const oversizedReq = {
    method: "POST",
    headers: { "content-length": String(70 * 1024), "x-forwarded-for": "203.0.113.10" },
    body: { message: "hello" },
    socket: {},
  };
  const oversizedRes = fakeRes();
  await chatHandler(oversizedReq, oversizedRes);
  assert.equal(oversizedRes.statusCode, 413);

  const deniedReq = {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.15" },
    body: { message: "hello" },
    socket: {},
  };
  const deniedRes = fakeRes();
  await chatHandler(deniedReq, deniedRes);
  assert.equal(deniedRes.statusCode, 401);
  assert.equal(deniedRes.body.code, "AUTH_REQUIRED");

  const statuses = [];
  const cookie = sessionCookie();
  for (let index = 0; index < 3; index += 1) {
    const req = {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.20", cookie },
      body: { message: `hello ${index}` },
      socket: {},
    };
    const res = fakeRes();
    await chatHandler(req, res);
    statuses.push(res.statusCode);
  }
  assert.deepEqual(statuses.slice(0, 2).every((status) => status === 503), true);
  assert.equal(statuses[2], 429);
});

test("chat limiter shares the window helper: admits, blocks and counts down without reaching zero", () => {
  const { check } = createChatRateLimiter();
  const env = { AI_RATE_LIMIT_PER_MINUTE: "3" };
  const t0 = 1_700_000_000_000;
  const key = "203.0.113.201";

  // First requests behave as before: they are admitted and never carry a wait.
  const admitted = [
    check(key, env, t0),
    check(key, env, t0 + 1_000),
    check(key, env, t0 + 2_000),
  ];
  assert.deepEqual(admitted.map((rate) => rate.allowed), [true, true, true]);
  assert.deepEqual(admitted.map((rate) => rate.retryAfter), [0, 0, 0]);
  assert.deepEqual(admitted.map((rate) => rate.limit), [3, 3, 3]);

  const blocked = check(key, env, t0 + 3_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 57);
  assert.equal(
    check(key, env, t0 + 30_000).retryAfter,
    30,
    "Retry-After must shrink as the oldest hit ages",
  );
  assert.equal(
    check(key, env, t0 + WINDOW_MS - 1).retryAfter,
    1,
    "a still-blocked request must never be told to retry in 0 seconds",
  );

  // Once every hit has aged out the client is admitted again.
  assert.equal(check(key, env, t0 + 63_000).allowed, true);
});

test("chat limiter sweeps expired clients instead of clearing every client's state", () => {
  const env = { AI_RATE_LIMIT_PER_MINUTE: "2" };
  const { check, tracked } = createChatRateLimiter();
  const t0 = 1_700_000_000_000;

  // Saturate the map with clients that will all expire together.
  for (let index = 0; index < MAX_CHAT_CLIENTS; index += 1) {
    check(`flood-${index}`, env, t0);
  }
  assert.ok(tracked() <= MAX_CHAT_CLIENTS, `bound must hold (got ${tracked()})`);

  // One client that is genuinely blocked in the current window.
  check("active", env, t0 + WINDOW_MS + 1);
  check("active", env, t0 + WINDOW_MS + 2);
  assert.equal(check("active", env, t0 + WINDOW_MS + 3).allowed, false);

  // Every expired flood bucket is gone, and only the expired ones.
  assert.ok(
    tracked() < 10,
    `expired clients must be swept, not kept or wiped wholesale (still ${tracked()})`,
  );
  assert.equal(check("flood-0", env, t0 + WINDOW_MS + 4).allowed, true);

  // The blocked client kept its hits: a blanket Map.clear() would have
  // silently re-admitted it, which is the defect this sweep replaces.
  assert.equal(
    check("active", env, t0 + WINDOW_MS + 5).allowed,
    false,
    "cleanup must not erase an active client's rate-limit state",
  );
});

test("Vercel chat 429 reports an accurate, decreasing Retry-After that matches its body", async () => {
  const cookie = sessionCookie();
  const realNow = Date.now;
  let clock = realNow();
  const send = async () => {
    const res = fakeRes();
    await chatHandler(
      {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.202", cookie },
        body: { message: "hello" },
        socket: {},
      },
      res,
    );
    return res;
  };

  try {
    Date.now = () => clock;
    // AI_RATE_LIMIT_PER_MINUTE is 2 in this file, so two requests get through.
    assert.equal((await send()).statusCode, 503);
    assert.equal((await send()).statusCode, 503);

    const blocked = await send();
    assert.equal(blocked.statusCode, 429);
    const first = Number(blocked.headers["retry-after"]);
    assert.equal(blocked.body.retryAfter, first, "header and body must agree");
    assert.ok(first > 0 && first <= 60, `unexpected Retry-After ${first}`);

    clock += 20_000;
    const aged = await send();
    assert.equal(aged.statusCode, 429);
    const second = Number(aged.headers["retry-after"]);
    assert.equal(aged.body.retryAfter, second);
    assert.ok(second < first, `Retry-After must count down (${first} -> ${second})`);

    clock += 60_000;
    assert.notEqual((await send()).statusCode, 429, "the expired window must re-admit");
  } finally {
    Date.now = realNow;
  }
});

test("Express chat 429 header and body agree and count down over the window", async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = sessionCookie();
  const realNow = Date.now;
  let clock = realNow();

  const post = async () => {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ message: "hello" }),
    });
    const body = await response.json();
    return { status: response.status, header: response.headers.get("retry-after"), body };
  };

  try {
    Date.now = () => clock;
    assert.equal((await post()).status, 503);
    assert.equal((await post()).status, 503);

    const blocked = await post();
    assert.equal(blocked.status, 429);
    const first = Number(blocked.header);
    assert.equal(blocked.body.retryAfter, first, "header and body must agree");
    assert.ok(first > 0 && first <= 60, `unexpected Retry-After ${first}`);
    assert.equal(
      blocked.body.error,
      "Too many requests. Please wait a minute and try again.",
      "the 429 response shape must stay as it was",
    );

    clock += 25_000;
    const aged = await post();
    assert.equal(aged.status, 429);
    const second = Number(aged.header);
    assert.equal(aged.body.retryAfter, second);
    assert.ok(second < first, `Retry-After must count down (${first} -> ${second})`);

    clock += 60_000;
    assert.notEqual((await post()).status, 429, "the expired window must re-admit");
  } finally {
    Date.now = realNow;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("both chat limiters share the window helper and no longer hard-code a 60 second wait", () => {
  const read = (relative) =>
    fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

  for (const file of ["api/chat.js", "server/server.js"]) {
    const source = read(file);
    assert.match(source, /lib\/chatRateLimit\.js/, `${file} must use the shared chat limiter`);
    assert.doesNotMatch(source, /Retry-After",\s*"60"/, `${file} must not send a fixed Retry-After`);
    assert.doesNotMatch(source, /retryAfter:\s*60\b/, `${file} must not report a fixed retryAfter`);
  }

  const shared = read("lib/chatRateLimit.js");
  assert.match(shared, /from "\.\/rateLimitWindow\.js"/, "the chat limiter must reuse the helper");
  assert.match(shared, /activeWindow\(/);
  assert.match(shared, /remainingSeconds\(/);
  assert.doesNotMatch(shared, /hits\.clear\(/, "cleanup must never drop every client at once");
});

test("session tokens are signed, expire and reject tampering", () => {
  const token = createSessionToken(process.env);
  const now = Date.now();
  assert.ok(verifySessionToken(token, process.env, now));

  const parts = token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${"0".repeat(64)}`;
  assert.equal(verifySessionToken(tampered, process.env, now), null);
  assert.equal(verifySessionToken("v1.not-a-number.abc", process.env, now), null);
  assert.equal(verifySessionToken(token, process.env, now + 13 * 60 * 60 * 1000), null);
  assert.equal(
    verifySessionToken(token, { ...process.env, GRANDMASTER_SESSION_SECRET: "" }, now),
    null,
  );
  resetAuthRateLimits();
});

test("audit records protected operations with structure and no credentials", async () => {
  resetRateLimits();
  const fakeKey = "AIzaSySECURITYFAKE123456789012345678";
  const env = { ...process.env, GEMINI_API_KEY: fakeKey };

  const created = await call("POST", "/memory", {
    headers: authorized,
    env,
    body: { text: "Security audit marker memory", category: "instruction" },
  });
  assert.equal(created.status, 201);
  const memoryId = created.body.data.memory.id;

  const patched = await call("PATCH", `/memory/${memoryId}`, {
    headers: authorized,
    env,
    body: { text: "Security audit marker memory updated" },
  });
  assert.equal(patched.status, 200);

  const deleted = await call("DELETE", `/memory/${memoryId}`, {
    headers: authorized,
    env,
  });
  assert.equal(deleted.status, 200);

  const audit = await call("GET", "/audit", { headers: authorized, env });
  assert.equal(audit.status, 200);
  const actions = audit.body.data.events.map((event) => event.action);
  for (const action of ["memory.created", "memory.updated", "memory.deleted", "audit.read"]) {
    assert.ok(actions.includes(action), `audit must contain ${action}`);
  }

  const serialized = JSON.stringify(audit.body);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes(fakeKey), false);

  const event = audit.body.data.events.find((item) => item.action === "memory.created");
  assert.ok(event.requestId);
  assert.equal(event.status, "201");
  assert.equal(event.outcome, "created");
  assert.equal(event.actor, "control-token");
  assert.ok(event.meta.memoryId);
  assert.equal(event.meta.text, undefined);
});

test("provider health labels use only honest states", () => {
  const provider = { configured: true, provider: "gemini", model: "test-model" };
  assert.equal(providerHealthLabel({ configured: false }), "NOT CONNECTED");
  assert.equal(providerHealthLabel(provider, null), "CAPABILITY NOT VERIFIED");
  assert.equal(
    providerHealthLabel(provider, { status: "verified" }),
    "CAPABILITY NOT VERIFIED",
  );
  assert.equal(
    providerHealthLabel(provider, {
      status: "verified",
      provider: "gemini",
      model: "other-model",
      checkedAt: new Date().toISOString(),
    }),
    "CAPABILITY NOT VERIFIED",
  );
  assert.equal(
    providerHealthLabel(provider, {
      status: "verified",
      provider: "gemini",
      model: "test-model",
      checkedAt: new Date().toISOString(),
    }),
    "GREEN",
  );
});

// Matrix case 14. The v1 parser splits on "/" first and only then
// decodeURIComponent()es each segment (lib/api/v1.js:683-693), so an encoded
// separator can never create a segment, and .slice(0, 6) caps the depth. These
// tests pin that real behavior: a hostile segment is treated as an opaque
// record id and answers exactly like an unknown id would. Nothing here changes
// the policy — it proves the policy already in the code.
test("v1 path segments treat traversal and encoding tricks as unknown ids", async () => {
  resetRateLimits();
  const baseline = await call("GET", `/tasks/${UNKNOWN_ID}`, {
    headers: authorized,
  });
  assert.equal(baseline.status, 404, "unknown id must be a 404 baseline");
  assert.equal(baseline.body.ok, false);

  const traversalPaths = [
    "/tasks/..",
    "/tasks/../",
    "/tasks/%2e%2e",
    "/tasks/%2E%2E",
    "/tasks/....",
    "/tasks/%252e%252e",
    "/tasks/..%2fapprove",
    "/tasks/a%2fb",
  ];

  for (const route of traversalPaths) {
    const response = await call("GET", route, { headers: authorized });
    assert.equal(
      response.status,
      baseline.status,
      `${route} must not answer differently from an unknown id`,
    );
    assert.equal(
      response.body.error.code,
      baseline.body.error.code,
      `${route} leaked a different error code`,
    );
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /(?:[A-Za-z]:\\|\/tmp\/|\/var\/|grandmaster-data|academy\.db)/,
      `${route} leaked a filesystem path`,
    );
  }

  // Deeper traversal shapes do not resolve to a record at all; they are simply
  // not routes. Both answers are rejections, but the codes differ honestly.
  const notFound = await call("GET", "/tasks/%2e%2e/%2e%2e/approve", {
    headers: authorized,
  });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error.code, "ENDPOINT_NOT_FOUND");

  const approved = await call("POST", "/tasks/../approve", {
    body: {},
    headers: authorized,
  });
  const approvedBaseline = await call("POST", `/tasks/${UNKNOWN_ID}/approve`, {
    body: {},
    headers: authorized,
  });
  assert.equal(approved.status, approvedBaseline.status);
  assert.equal(approved.body.error.code, approvedBaseline.body.error.code);

  // A valid path still resolves, so the assertions above are not blanket 404s.
  const status = await call("GET", "/status");
  assert.equal(status.status, 200);
  const agents = await call("GET", "/agents");
  assert.equal(agents.status, 200);
});

test("v1 rejects path segment chains longer than the supported depth", async () => {
  resetRateLimits();
  const deep = await call("GET", "/status/extra/deep/segments/here/now/again");
  assert.equal(deep.status, 404);
  assert.equal(deep.body.error.code, "ENDPOINT_NOT_FOUND");

  const deepTraversal = await call("GET", "/tasks/../../x/y/z/w/v/u");
  assert.equal(deepTraversal.status, 404);
  assert.equal(deepTraversal.body.error.code, "ENDPOINT_NOT_FOUND");
  assert.doesNotMatch(JSON.stringify(deepTraversal.body), /academy\.db|\/tmp\//);

  const deepWrite = await call("POST", "/tasks/id/approve/a/b/c/d/e/f", {
    body: {},
    headers: authorized,
  });
  assert.equal(deepWrite.status, 404);
  assert.equal(deepWrite.body.error.code, "ENDPOINT_NOT_FOUND");

  // The same route at a supported depth still works, proving the cap is a
  // segment-count rule and not a rejection of the resource itself.
  const shallow = await call("GET", "/status");
  assert.equal(shallow.status, 200);
});

// Client IP trust boundary. Vercel overwrites x-forwarded-for with the client's
// public IP and does not forward an external one (documented at
// https://vercel.com/docs/headers/request-headers; a Trusted Proxy that could
// preserve one is Enterprise-only), so the adapters may key on that header. The
// self-hosted Express server sets no `trust proxy`, so its boundary is the
// socket peer. These tests pin both of those facts without asserting anything
// about how the platform behaves beyond its own documentation.
test("a spoofed forwarded header cannot buy a new chat quota on Express", async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = sessionCookie();

  // AI_RATE_LIMIT_PER_MINUTE is 2 here and every request arrives from
  // 127.0.0.1. Three different spoofed values must still share one bucket.
  const post = async (spoofed) => {
    const headers = { "Content-Type": "application/json", cookie };
    if (spoofed) headers["x-forwarded-for"] = spoofed;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "hello" }),
    });
    return response.status;
  };

  try {
    assert.equal(await post("203.0.113.77"), 503);
    assert.equal(await post("203.0.113.88"), 503);
    assert.equal(await post("203.0.113.99"), 429, "a spoofed header must not reset the quota");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("forwarded-header client keys follow the documented adapter contract", () => {
  assert.equal(
    clientKeyFrom({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, socket: {} }),
    "203.0.113.9",
    "the adapter takes the public client address that Vercel reports first",
  );
  assert.equal(
    clientKeyFrom({ headers: {}, socket: { remoteAddress: "198.51.100.24" } }),
    "198.51.100.24",
    "with no forwarded header the socket peer is the key",
  );
  assert.equal(clientKeyFrom({ headers: {}, socket: {} }), "unknown");
});
