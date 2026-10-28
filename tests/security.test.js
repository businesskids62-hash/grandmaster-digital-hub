import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-security-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "security-control-token-1234567890";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.GRANDMASTER_RATE_LIMIT_PER_MINUTE = "1000";
process.env.RATE_LIMIT_PER_MINUTE = "2";
process.env.ALLOWED_ORIGINS = "http://localhost:5173";
process.env.AI_PROVIDERS = "gemini:test-model";
process.env.GEMINI_API_KEY = "";
process.env.AI_API_KEY = "";
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

const { handleV1, resetRateLimits } = await import("../lib/api/v1.js");
const { applyCors, isOriginAllowed, getAllowedOrigins } = await import("../lib/cors.js");
const { providerHealthLabel } = await import("../lib/aiProviders.js");
const chatHandler = (await import("../api/chat.js")).default;
const { createApp } = await import("../server/server.js");
const { memoryStore } = await import("../lib/memory/memoryStore.js");
const { submitTask } = await import("../lib/orchestrator/mastermind.js");

const TOKEN = "security-control-token-1234567890";
const authorized = { "x-grandmaster-token": TOKEN };
const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";
let sequence = 0;

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
  assert.equal(isOriginAllowed("https://evil.example"), false);
  assert.equal(
    isOriginAllowed("https://evil.example", {
      ...process.env,
      ALLOWED_ORIGINS: "*",
    }),
    false,
  );
  assert.ok(!getAllowedOrigins({ ...process.env, ALLOWED_ORIGINS: "*" }).includes("*"));

  const deniedRes = fakeRes();
  const answered = applyCors(
    { method: "GET", headers: { origin: "https://evil.example" } },
    deniedRes,
  );
  assert.equal(answered, true);
  assert.equal(deniedRes.statusCode, 403);
});

test("Express app enforces CORS, body limits and honest health labels end to end", async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

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
    const health = await allowed.json();
    assert.equal(health.status, "DEGRADED");
    assert.equal(health.service, "GREEN");
    assert.equal(health.ok, true);
    assert.equal(health.checks.controlAuthority.status, "pass");
    assert.equal(health.checks.aiProvider.configured, false);
    assert.ok(health.reasonCodes.includes("AI_PROVIDER_NOT_CONFIGURED"));
    assert.ok(
      ["GREEN", "NOT CONNECTED", "CAPABILITY NOT VERIFIED", "DATA REQUIRED"].includes(
        health.providerStatus,
      ),
    );

    const wrongMethod = await fetch(`${base}/api/health`, { method: "POST" });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "GET, HEAD");

    const oversized = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(70 * 1024) }),
    });
    assert.equal(oversized.status, 413);

    const chatStatuses = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

test("Vercel chat adapter rejects oversized bodies and rate limits with 429", async () => {
  const oversizedReq = {
    method: "POST",
    headers: { "content-length": String(70 * 1024), "x-forwarded-for": "203.0.113.10" },
    body: { message: "hello" },
    socket: {},
  };
  const oversizedRes = fakeRes();
  await chatHandler(oversizedReq, oversizedRes);
  assert.equal(oversizedRes.statusCode, 413);

  const statuses = [];
  for (let index = 0; index < 3; index += 1) {
    const req = {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.20" },
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
