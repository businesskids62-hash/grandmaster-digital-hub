import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-api-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "test-control-token-1234567890";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.AI_PROVIDERS = "gemini:test-model";
delete process.env.GEMINI_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

const { handleV1, resetRateLimits } = await import("../lib/api/v1.js");

const TOKEN = "test-control-token-1234567890";
const authorized = { "x-grandmaster-token": TOKEN };
let sequence = 0;

async function call(method, requestPath, options = {}) {
  sequence += 1;
  return handleV1({
    method,
    path: requestPath,
    query: options.query || {},
    headers: {
      "x-request-id": `test-request-${sequence}`,
      ...(options.headers || {}),
    },
    body: options.body,
    env: options.env || process.env,
    clientKey: options.clientKey || `test-client-${sequence}`,
  });
}

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("GET /status returns an honest envelope and never leaks the API key", async () => {
  const fakeKey = "AIzaSyFAKE123456789012345678901234567";
  const response = await call("GET", "/status", {
    env: { ...process.env, GEMINI_API_KEY: fakeKey },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.agents.total, 21);
  assert.equal(response.body.data.phase, 3);
  assert.equal(response.body.data.limitations.length > 0, true);
  assert.equal(response.requestId, response.body.requestId);
  assert.ok(!JSON.stringify(response.body).includes(fakeKey));
});

test("GET /agents lists all 21 agents and an unknown agent is a 404", async () => {
  const list = await call("GET", "/agents");
  assert.equal(list.status, 200);
  assert.equal(list.body.data.count, 21);
  assert.equal(list.body.data.agents.length, 21);
  assert.equal(list.body.data.desks.length, 5);
  assert.deepEqual(
    list.body.data.desks.map((desk) => desk.id),
    ["mastermind", "mt5_monitor", "risk_manager", "communications", "social"],
  );
  assert.equal(
    list.body.data.desks.every((desk) => desk.externalExecutionEnabled === false),
    true,
  );

  const detail = await call("GET", "/agents/mastermind");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.agent.id, "mastermind");

  const missing = await call("GET", "/agents/does-not-exist");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "UNKNOWN_AGENT");
});

test("plan validates input and rejects malformed JSON", async () => {
  const valid = await call("POST", "/mastermind/plan", {
    body: { request: "plan a react dashboard" },
  });
  assert.equal(valid.status, 200);
  assert.ok(valid.body.data.plan.agentId);

  const empty = await call("POST", "/mastermind/plan", { body: {} });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error.code, "REQUEST_REQUIRED");

  const malformed = await call("POST", "/tasks", {
    headers: authorized,
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "INVALID_JSON");
});

test("financial execution is locked by the API", async () => {
  const before = await call("GET", "/tasks", { headers: authorized });
  const response = await call("POST", "/tasks", {
    headers: authorized,
    body: { request: "withdraw funds from my account" },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error.code, "ACTION_LOCKED");
  assert.ok(response.body.details.plan.steps.some((step) => step.status === "blocked"));

  const afterTasks = await call("GET", "/tasks", { headers: authorized });
  assert.equal(afterTasks.body.data.tasks.length, before.body.data.tasks.length);
});

test("external action requires control token, fails honestly and enforces retry limit", async () => {
  const created = await call("POST", "/tasks", {
    headers: authorized,
    body: { request: "publish this post on instagram now", idempotencyKey: "api-approval-1" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.task.status, "AWAITING_APPROVAL");
  const taskId = created.body.data.task.id;

  const duplicate = await call("POST", "/tasks", {
    headers: authorized,
    body: { request: "publish this post on instagram now", idempotencyKey: "api-approval-1" },
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.data.duplicate, true);

  const noToken = await call("POST", `/tasks/${taskId}/approve`);
  assert.equal(noToken.status, 403);
  assert.equal(noToken.body.error.code, "APPROVAL_REQUIRED");

  const badToken = await call("POST", `/tasks/${taskId}/approve`, {
    headers: { "x-grandmaster-token": "not-the-token-000000" },
  });
  assert.equal(badToken.status, 403);
  assert.equal(badToken.body.error.code, "INVALID_CONTROL_TOKEN");

  const approved = await call("POST", `/tasks/${taskId}/approve`, {
    headers: authorized,
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.task.status, "QUEUED");

  const run = await call("POST", `/tasks/${taskId}/run`, {
    headers: authorized,
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.data.task.status, "FAILED");
  assert.equal(run.body.data.task.result, null);
  assert.equal(run.body.data.task.error.code, "EXTERNAL_ACTION_NOT_IMPLEMENTED");

  const retryDenied = await call("POST", `/tasks/${taskId}/retry`);
  assert.equal(retryDenied.status, 403);
  assert.equal(retryDenied.body.error.code, "APPROVAL_REQUIRED");

  const retry = await call("POST", `/tasks/${taskId}/retry`, {
    headers: authorized,
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.task.attempts, 2);

  const limited = await call("POST", `/tasks/${taskId}/retry`, {
    headers: authorized,
  });
  assert.equal(limited.status, 409);
  assert.equal(limited.body.error.code, "RETRY_LIMIT_REACHED");
});

test("task lookup requires a token and returns 404 for unknown ids", async () => {
  const denied = await call("GET", "/tasks/00000000-0000-0000-0000-000000000000");
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "APPROVAL_REQUIRED");

  const response = await call("GET", "/tasks/00000000-0000-0000-0000-000000000000", {
    headers: authorized,
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "TASK_NOT_FOUND");
});

test("memory create, search, update and delete are gated and audited", async () => {
  const denied = await call("POST", "/memory", {
    body: { text: "Prefers concise answers", category: "preference" },
  });
  assert.equal(denied.status, 403);

  const secret = await call("POST", "/memory", {
    headers: authorized,
    body: { text: "password is hunter2", category: "preference" },
  });
  assert.equal(secret.status, 400);
  assert.equal(secret.body.error.code, "MEMORY_SECRET_REJECTED");

  const created = await call("POST", "/memory", {
    headers: authorized,
    body: {
      text: "Prefers evidence-based recommendations",
      category: "preference",
      tags: ["tone"],
    },
  });
  assert.equal(created.status, 201);
  const memoryId = created.body.data.memory.id;

  const found = await call("GET", "/memory", {
    headers: authorized,
    query: { q: "evidence" },
  });
  assert.equal(found.status, 200);
  assert.ok(found.body.data.memories.some((item) => item.id === memoryId));

  const patchDenied = await call("PATCH", `/memory/${memoryId}`, {
    body: { text: "changed" },
  });
  assert.equal(patchDenied.status, 403);

  const patched = await call("PATCH", `/memory/${memoryId}`, {
    headers: authorized,
    body: { text: "Prefers evidence-based recommendations and short answers" },
  });
  assert.equal(patched.status, 200);
  assert.match(patched.body.data.memory.text, /short answers/);

  const deleted = await call("DELETE", `/memory/${memoryId}`, {
    headers: authorized,
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.deleted, true);
});

test("audit log is token protected and contains no secrets", async () => {
  const denied = await call("GET", "/audit");
  assert.equal(denied.status, 403);
  const allowed = await call("GET", "/audit", { headers: authorized });
  assert.equal(allowed.status, 200);
  assert.ok(Array.isArray(allowed.body.data.events));
  assert.ok(!JSON.stringify(allowed.body).includes(TOKEN));
});

test("integrations report NOT CONNECTED and tests perform no external action", async () => {
  const response = await call("GET", "/integrations");
  assert.equal(response.status, 200);
  const whatsapp = response.body.data.integrations.find(
    (item) => item.id === "whatsapp_business",
  );
  assert.equal(whatsapp.status, "not_connected");

  const testedDenied = await call("POST", "/integrations/whatsapp_business/test");
  assert.equal(testedDenied.status, 403);
  assert.equal(testedDenied.body.error.code, "APPROVAL_REQUIRED");

  const tested = await call("POST", "/integrations/whatsapp_business/test", {
    headers: authorized,
  });
  assert.equal(tested.status, 200);
  assert.equal(tested.body.data.performed, false);
  assert.equal(tested.body.data.status, "not_connected");

  const unknown = await call("POST", "/integrations/nope/test", {
    headers: authorized,
  });
  assert.equal(unknown.status, 404);
});

test("security posture is public and notifications require authorization", async () => {
  const posture = await call("GET", "/security/posture");
  assert.equal(posture.status, 200);
  assert.ok(Array.isArray(posture.body.data.posture.lockedActions));

  const denied = await call("GET", "/notifications");
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "APPROVAL_REQUIRED");

  const notifications = await call("GET", "/notifications", {
    headers: authorized,
  });
  assert.equal(notifications.status, 200);
  assert.equal(notifications.body.data.channels.find((c) => c.id === "in_app").status, "operational");
});

test("write rate limiting returns 429 with Retry-After", async () => {
  resetRateLimits();
  const env = { ...process.env, GRANDMASTER_RATE_LIMIT_PER_MINUTE: "2" };
  const first = await call("POST", "/mastermind/plan", {
    body: { request: "plan one" },
    env,
    clientKey: "rate-test-client",
  });
  const second = await call("POST", "/mastermind/plan", {
    body: { request: "plan two" },
    env,
    clientKey: "rate-test-client",
  });
  const third = await call("POST", "/mastermind/plan", {
    body: { request: "plan three" },
    env,
    clientKey: "rate-test-client",
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, "RATE_LIMITED");
  assert.ok(Number(third.headers["Retry-After"]) >= 1);
  resetRateLimits();
});

test("api rate limiting counts the window down with a fake clock", async () => {
  resetRateLimits();
  const realNow = Date.now;
  const start = 1_700_000_000_000;
  let clock = start;
  Date.now = () => clock;
  const env = { ...process.env, GRANDMASTER_RATE_LIMIT_PER_MINUTE: "1" };

  try {
    const plan = (request) =>
      call("POST", "/mastermind/plan", { body: { request }, env, clientKey: "clock-client" });

    assert.equal((await plan("one")).status, 200);

    clock = start + 1;
    const fresh = await plan("two");
    assert.equal(fresh.status, 429);
    assert.equal(fresh.headers["Retry-After"], "60", "a fresh hit still has the whole window");

    clock = start + 30_000;
    assert.equal((await plan("three")).headers["Retry-After"], "30");

    clock = start + 59_500;
    const tail = await plan("four");
    assert.equal(tail.status, 429);
    assert.equal(tail.headers["Retry-After"], "1", "rounds up and never reports zero");
    assert.match(tail.body.error.message, /Retry after 1 seconds/);

    clock = start + 59_999;
    assert.equal((await plan("five")).headers["Retry-After"], "1", "just before expiry");

    clock = start + 60_000;
    const expired = await plan("six");
    assert.equal(expired.status, 200, "the window expires at its own length");
    assert.equal(expired.headers?.["Retry-After"], undefined, "no stale Retry-After after expiry");

    clock = start + 60_001;
    const reopened = await plan("seven");
    assert.equal(reopened.status, 429);
    assert.equal(reopened.headers["Retry-After"], "60", "the new hit starts a fresh window");
  } finally {
    Date.now = realNow;
    resetRateLimits();
  }
});

test("v1 capacity cleanup preserves an active client's quota", async () => {
  resetRateLimits();
  const realNow = Date.now;
  const start = 1_700_000_000_000;
  let clock = start;
  Date.now = () => clock;
  const env = { ...process.env, GRANDMASTER_RATE_LIMIT_PER_MINUTE: "1" };
  const post = (request, clientKey) =>
    call("POST", "/mastermind/plan", { body: { request }, env, clientKey });
  const visit = (clientKey) => call("GET", "/nope", { env, clientKey });

  try {
    // The 404 route is the cheapest path that still passes through the limiter.
    for (let index = 0; index < 2000; index += 1) {
      assert.equal((await visit(`flood-${index}`)).status, 404);
    }

    clock = start + 500;
    assert.equal((await post("one", "blocked")).status, 200);
    const blocked = await post("two", "blocked");
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers["Retry-After"], "60");

    clock = start + 30_500;
    assert.equal((await visit("new-visitor")).status, 404);

    const afterCleanup = await post("three", "blocked");
    assert.equal(afterCleanup.status, 429, "cleanup of another client must not reset this quota");
    assert.equal(afterCleanup.headers["Retry-After"], "30", "Retry-After stays accurate");
    assert.match(afterCleanup.body.error.message, /Retry after 30 seconds/);

    clock = start + 60_500;
    assert.equal((await post("four", "blocked")).status, 200, "the window still expires");
  } finally {
    Date.now = realNow;
    resetRateLimits();
  }
});

test("v1 capacity cleanup expires stale buckets first and evicts the coldest", async () => {
  resetRateLimits();
  const realNow = Date.now;
  const start = 1_700_000_000_000;
  let clock = start;
  Date.now = () => clock;
  const env = { ...process.env, GRANDMASTER_RATE_LIMIT_PER_MINUTE: "1" };
  const post = (request, clientKey) =>
    call("POST", "/mastermind/plan", { body: { request }, env, clientKey });
  const visit = (clientKey) => call("GET", "/nope", { env, clientKey });

  try {
    for (let index = 0; index < 2000; index += 1) {
      assert.equal((await visit(`stale-${index}`)).status, 404);
    }

    // Past the window, so the whole stale set is reclaimed before any eviction.
    clock = start + 61_000;
    for (let index = 0; index < 1999; index += 1) {
      assert.equal((await visit(`cold-${index}`)).status, 404);
    }

    clock = start + 61_500;
    assert.equal((await post("one", "active")).status, 200);
    const blocked = await post("two", "active");
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers["Retry-After"], "60");

    clock = start + 90_000;
    assert.equal((await visit("late")).status, 404, "capacity is still available to a new client");
    const held = await post("three", "active");
    assert.equal(held.status, 429, "a more recently active client is not the eviction target");
    assert.equal(held.headers["Retry-After"], "32", `unexpected Retry-After ${held.headers["Retry-After"]}`);
  } finally {
    Date.now = realNow;
    resetRateLimits();
  }
});

test("v1 rate limiting isolates client identities and read from write windows", async () => {
  resetRateLimits();
  const env = { ...process.env, GRANDMASTER_RATE_LIMIT_PER_MINUTE: "1" };
  const post = (request, clientKey) =>
    call("POST", "/mastermind/plan", { body: { request }, env, clientKey });

  assert.equal((await post("one", "iso-a")).status, 200);
  const exhausted = await post("two", "iso-a");
  assert.equal(exhausted.status, 429);
  assert.equal((await post("three", "iso-b")).status, 200, "each client keeps its own quota");
  assert.equal((await call("GET", "/status", { env, clientKey: "iso-a" })).status, 200);
  resetRateLimits();
});

test("v1 answers keep the existing envelope before, during and after cleanup", async () => {
  resetRateLimits();
  const env = { ...process.env, GRANDMASTER_RATE_LIMIT_PER_MINUTE: "1" };
  const post = (request, clientKey) =>
    call("POST", "/mastermind/plan", { body: { request }, env, clientKey });

  const ok = await post("compat one", "compat-a");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.requestId, ok.body.requestId, "the requestId envelope pair must stay linked");
  assert.ok(ok.body.data, "a success response still carries a data object");

  const denied = await post("compat two", "compat-a");
  assert.equal(denied.status, 429);
  assert.equal(denied.body.ok, false);
  assert.equal(denied.body.error.code, "RATE_LIMITED");
  assert.match(denied.body.error.message, /^Too many requests\. Retry after \d+ seconds\.$/);
  assert.equal(denied.requestId, denied.body.requestId);
  assert.ok(Number(denied.headers["Retry-After"]) >= 1);

  const missing = await call("GET", "/nope", { env, clientKey: "compat-b" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.ok, false);
  assert.equal(missing.body.error.code, "ENDPOINT_NOT_FOUND");

  // Capacity cleanup must not change the shapes above. The preserved-quota case
  // is covered by the two fake-clock tests, where the timestamps are controlled.
  for (let index = 0; index < 2000; index += 1) {
    assert.equal((await call("GET", "/nope", { env, clientKey: `compat-flood-${index}` })).status, 404);
  }
  const afterSweep = await call("GET", "/nope", { env, clientKey: "compat-c" });
  assert.equal(afterSweep.status, 404);
  assert.equal(afterSweep.body.error.code, "ENDPOINT_NOT_FOUND");
  const admitted = await post("compat three", "compat-c");
  assert.equal(admitted.status, 200, "a fresh identity is unaffected by the sweep");
  assert.equal(admitted.body.ok, true);
  const secondDenied = await post("compat four", "compat-c");
  assert.equal(secondDenied.status, 429);
  assert.equal(secondDenied.body.error.code, "RATE_LIMITED");
  resetRateLimits();
});

test("v1 rate limiter uses bounded cleanup instead of a wholesale clear", () => {
  const source = fs.readFileSync(new URL("../lib/api/v1.js", import.meta.url), "utf8");
  assert.match(
    source,
    /import \{[^}]*WINDOW_MS[^}]*\} from "\.\.\/rateLimitWindow\.js"/,
    "the shared window length must be reused, not re-declared",
  );
  assert.match(source, /MAX_RATE_BUCKETS/, "capacity must be a named bound");
  assert.match(source, /sweepBuckets\(/, "cleanup must be a bounded sweep");
  assert.match(
    source,
    /String\(clientKey[^)]*\)\.slice\(0, 120\)/,
    "the client key must be bounded like every other limiter",
  );
  assert.equal(
    (source.match(/rateBuckets\.clear\(\)/g) || []).length,
    1,
    "only resetRateLimits() may clear the map",
  );
  assert.doesNotMatch(
    source,
    /if \(rateBuckets\.size[^{}]*\)\s*rateBuckets\.clear\(\)/,
    "no size-triggered wholesale clear may come back",
  );
});

test("unknown endpoints return a structured 404", async () => {
  const response = await call("GET", "/nope");
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "ENDPOINT_NOT_FOUND");
  assert.ok(response.body.requestId);
});
