import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Environment must be set before importing modules that create file-backed stores.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-core-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "test-control-token-1234567890";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.AI_PROVIDERS = "gemini:test-model";
delete process.env.GEMINI_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

const { AGENT_REGISTRY, getRuntimeAgents } = await import("../lib/agents/registry.js");
const {
  buildPlan,
  submitTask,
  executeTask,
  approveTask,
  retryTask,
} = await import("../lib/orchestrator/mastermind.js");
const { taskStore } = await import("../lib/tasks/taskStore.js");
const { memoryStore } = await import("../lib/memory/memoryStore.js");
const { auditStore } = await import("../lib/security/auditStore.js");
const { executeProviderRotation } = await import("../lib/aiProviders.js");
const { getSecurityPosture } = await import("../lib/security/posture.js");
const { authorizeControlRequest } = await import("../lib/security/approval.js");

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("agent registry exposes exactly 20 unique specialist contracts", () => {
  assert.equal(AGENT_REGISTRY.length, 20);
  assert.equal(new Set(AGENT_REGISTRY.map((item) => item.id)).size, 20);
  for (const agent of AGENT_REGISTRY) {
    assert.ok(agent.name, `${agent.id} has a name`);
    assert.ok(agent.responsibility, `${agent.id} has a responsibility`);
    assert.ok(Array.isArray(agent.capabilities) && agent.capabilities.length > 0);
    assert.ok(agent.permissions && typeof agent.permissions === "object");
    assert.ok(agent.inputContract && agent.outputContract);
    assert.ok(Array.isArray(agent.connections));
    assert.ok(["low", "medium", "high"].includes(agent.risk));
  }
});

test("runtime agents never claim unverified capability", () => {
  const agents = getRuntimeAgents({}, { storageAvailable: true });
  assert.equal(agents.length, 20);
  for (const agent of agents) {
    assert.ok(agent.statusReason.length > 0);
    if (agent.implementation !== "operational") {
      assert.notEqual(agent.gate, "GREEN", `${agent.id} must not be GREEN`);
    }
  }
  const trading = agents.find((item) => item.id === "trading_monitor");
  assert.equal(trading.gate, "LOCKED");
  const social = agents.find((item) => item.id === "social_media");
  assert.equal(social.gate, "APPROVAL REQUIRED");
});

test("plan classifies a request without calling a provider", () => {
  const plan = buildPlan("write a react component for a pricing table", {});
  assert.equal(plan.agentId, "coding");
  assert.equal(plan.locked, false);
  assert.ok(Array.isArray(plan.steps) && plan.steps.length >= 3);
});

test("memory agent task completes only after validation and records full lifecycle", async () => {
  const result = await submitTask({
    request: "remember: prefer short, evidence-based answers",
    agentId: "memory",
    env: {},
  });
  const task = result.task;
  assert.equal(task.status, "COMPLETED");
  assert.equal(task.result.ok, true);
  assert.ok(task.result.summary.length > 0);
  assert.ok(task.result.data.memoryId);
  assert.ok(!task.error);
  const statuses = task.history.map((entry) => entry.status);
  for (const expected of ["PLANNING", "RUNNING", "VALIDATING", "COMPLETED"]) {
    assert.ok(statuses.includes(expected), `history contains ${expected}`);
  }
  assert.equal(
    task.history.filter((entry) => entry.status === "COMPLETED").length,
    1,
  );
});

test("financial execution is locked and creates no task", async () => {
  const before = taskStore.stats().total;
  const result = await submitTask({
    request: "buy 1 lot gold on MT5 now",
    env: {},
  });
  assert.equal(result.locked, true);
  assert.equal(result.task, null);
  assert.equal(result.plan.gate, "LOCKED");
  assert.equal(taskStore.stats().total, before);
});

test("approval gate, external action failure, retry and retry limit", async () => {
  const request = "publish this post on instagram now";
  const created = await submitTask({
    request,
    idempotencyKey: "core-approval-1",
    env: {},
  });
  assert.equal(created.task.status, "AWAITING_APPROVAL");
  assert.equal(created.approvalRequired, true);

  const duplicate = await submitTask({
    request,
    idempotencyKey: "core-approval-1",
    env: {},
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.task.id, created.task.id);

  await assert.rejects(
    executeTask(created.task.id, { env: {} }),
    (error) => error.code === "APPROVAL_REQUIRED" && error.status === 409,
  );

  const approved = await approveTask(created.task.id, { env: {} });
  assert.equal(approved.status, "QUEUED");
  assert.equal(approved.approval.status, "approved");

  const failed = await executeTask(created.task.id, { env: {} });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.result, null);
  assert.equal(failed.error.code, "EXTERNAL_ACTION_NOT_IMPLEMENTED");
  assert.equal(failed.attempts, 1);

  const retried = await retryTask(created.task.id, { env: {} });
  assert.equal(retried.status, "FAILED");
  assert.equal(retried.attempts, 2);

  await assert.rejects(
    retryTask(created.task.id, { env: {} }),
    (error) => error.code === "RETRY_LIMIT_REACHED" && error.status === 409,
  );
});

test("completed task cannot be approved or rerun", async () => {
  const result = await submitTask({
    request: "remember: task transitions are enforced",
    agentId: "memory",
    env: {},
  });
  await assert.rejects(
    approveTask(result.task.id, { env: {} }),
    (error) => error.status === 409 && error.code === "INVALID_TRANSITION",
  );
  await assert.rejects(
    executeTask(result.task.id, { env: {} }),
    (error) => error.status === 409 && error.code === "INVALID_TRANSITION",
  );
});

test("memory validation rejects secrets, dedupes and enforces authorization", async () => {
  await assert.rejects(
    memoryStore.create({
      text: "my api key is AIzaSyFAKE123456789012345678901234567",
      category: "preference",
    }),
    (error) => error.code === "MEMORY_SECRET_REJECTED" && error.status === 400,
  );

  const first = await memoryStore.create({
    text: "Prefers concise Urdu and English answers",
    category: "preference",
  });
  assert.equal(first.duplicate, false);

  const second = await memoryStore.create({
    text: "Prefers concise Urdu and English answers",
    category: "preference",
  });
  assert.equal(second.duplicate, true);
  assert.equal(second.item.id, first.item.id);

  await assert.rejects(
    memoryStore.update(first.item.id, { text: "changed" }),
    (error) => error.code === "APPROVAL_REQUIRED",
  );
  await assert.rejects(
    memoryStore.remove(first.item.id),
    (error) => error.code === "APPROVAL_REQUIRED",
  );

  const updated = await memoryStore.update(
    first.item.id,
    { text: "Prefers concise answers with evidence" },
    { authorized: true },
  );
  assert.match(updated.text, /evidence/);

  const found = memoryStore.list({ query: "evidence" });
  assert.ok(found.some((item) => item.id === first.item.id));

  const removed = await memoryStore.remove(first.item.id, { authorized: true });
  assert.equal(removed.deleted, true);
  assert.equal(memoryStore.get(first.item.id), null);
});

test("audit store drops sensitive keys and redacts secret-like values", async () => {
  const entry = await auditStore.append({
    action: "test.event",
    actor: "unit-test",
    outcome: "recorded",
    meta: {
      apiKey: "AIzaSyFAKE123456789012345678901234567",
      password: "hunter2",
      authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
      note: "key AIzaSyFAKE123456789012345678901234567 leaked",
      safe: "visible",
    },
  });
  assert.equal(entry.meta.apiKey, undefined);
  assert.equal(entry.meta.password, undefined);
  assert.equal(entry.meta.authorization, undefined);
  assert.equal(entry.meta.safe, "visible");
  assert.equal(entry.meta.note, "[redacted]");
  const serialized = JSON.stringify(auditStore.list(50));
  assert.ok(!serialized.includes("AIzaSyFAKE"));
  assert.ok(!serialized.includes("hunter2"));
});

test("provider rotation fails cleanly when nothing is configured", async () => {
  let fetched = false;
  await assert.rejects(
    executeProviderRotation({
      message: "hello",
      env: {},
      fetchImpl: async () => {
        fetched = true;
        throw new Error("must not be called");
      },
    }),
    (error) => {
      assert.equal(error.code, "ALL_PROVIDERS_FAILED");
      assert.equal(error.status, 503);
      assert.ok(Array.isArray(error.attempts) && error.attempts.length > 0);
      assert.ok(
        error.attempts.every(
          (attempt) =>
            attempt.status === "failed" &&
            attempt.errorCategory === "provider_not_configured",
        ),
      );
      return true;
    },
  );
  assert.equal(fetched, false);
});

test("control authorization uses exact tokens and refuses missing authority", () => {
  const env = { GRANDMASTER_CONTROL_TOKEN: "test-control-token-1234567890" };
  assert.equal(authorizeControlRequest({}, env).code, "APPROVAL_REQUIRED");
  assert.equal(
    authorizeControlRequest({ "x-grandmaster-token": "wrong" }, env).code,
    "INVALID_CONTROL_TOKEN",
  );
  assert.equal(
    authorizeControlRequest(
      { "x-grandmaster-token": "test-control-token-1234567890" },
      env,
    ).ok,
    true,
  );
  assert.equal(authorizeControlRequest({}, {}).code, "APPROVAL_AUTHORITY_NOT_CONFIGURED");
});

test("security posture reports locked financial controls", () => {
  const posture = getSecurityPosture({}, { storage: taskStore.status() });
  const byAction = Object.fromEntries(
    posture.lockedActions.map((entry) => [entry.action, entry.status]),
  );
  assert.equal(byAction.real_trading, "LOCKED");
  assert.equal(byAction.money_movement, "LOCKED");
  assert.equal(byAction.mt5, "MONITOR ONLY");
  assert.equal(byAction.binance, "RESEARCH ONLY");
  assert.equal(byAction.external_publishing, "APPROVAL REQUIRED");
  assert.equal(byAction.memory_update_delete, "APPROVAL REQUIRED");
  assert.equal(posture.controlAuthorityConfigured, false);
});
