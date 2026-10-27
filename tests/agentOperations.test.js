import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-desk-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "desk-control-token-1234567890";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.AI_PROVIDERS = "gemini:test-model";
delete process.env.GEMINI_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

const { handleV1 } = await import("../lib/api/v1.js");

const TOKEN = "desk-control-token-1234567890";
const authorized = { "x-grandmaster-token": TOKEN };
const GATE_LABELS = new Set(["GREEN", "NOT CONNECTED", "APPROVAL REQUIRED", "LOCKED"]);
let sequence = 0;

async function call(method, requestPath, options = {}) {
  sequence += 1;
  return handleV1({
    method,
    path: requestPath,
    query: options.query || {},
    headers: {
      "x-request-id": `desk-request-${sequence}`,
      ...(options.headers || {}),
    },
    body: options.body,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl,
    clientKey: options.clientKey || `desk-client-${sequence}`,
  });
}

function readSource(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("Agent Operations route, nav entry and API boundary are registered", () => {
  const app = readSource("src/App.jsx");
  const desk = readSource("src/pages/AgentDesks.jsx");

  assert.match(app, /import AgentDesks from "\.\/pages\/AgentDesks\.jsx"/);
  assert.match(app, /label: "Agent Operations"/);
  assert.match(app, /desks: \(\) => <AgentDesks apiBase=\{API_BASE\} \/>/);
  assert.match(desk, /\/api\/v1\$\{path\}/);
  assert.doesNotMatch(desk, /from "\.\.\/\.\.\/lib\//);
  assert.doesNotMatch(desk, /from "\.\.\/lib\//);
  assert.equal(desk.includes("const MOCK"), false);
  assert.equal(desk.includes("FIXTURES"), false);
});

test("loading, empty, error, retry and malformed-response states exist", () => {
  const desk = readSource("src/pages/AgentDesks.jsx");

  assert.match(desk, /Loading agent operations data/);
  assert.match(desk, /No agents returned by the backend/);
  assert.match(desk, /No tasks recorded yet/);
  assert.match(desk, /No memories stored/);
  assert.match(desk, /No audit events recorded/);
  assert.match(desk, /role="alert"/);
  assert.match(desk, /MALFORMED_RESPONSE/);
  assert.match(desk, /onClick=\{loadCore\}/);
  assert.match(desk, /No substitute data is shown/);
});

test("task data comes from the real API contract", async () => {
  const created = await call("POST", "/tasks", {
    body: { request: "remember that concise reports are preferred" },
  });
  assert.equal(created.status, 201);
  const task = created.body.data.task;
  assert.ok(task.id);
  assert.equal(task.request, "remember that concise reports are preferred");
  assert.equal(task.agentId, "memory");
  assert.ok(task.status);
  assert.ok(task.createdAt);
  assert.ok(Array.isArray(task.history));

  const listed = await call("GET", "/tasks", { query: { limit: "20" } });
  assert.equal(listed.status, 200);
  const stored = listed.body.data.tasks.find((item) => item.id === task.id);
  assert.ok(stored, "the created task must be returned by the list endpoint");
  assert.equal(stored.id, task.id);
  assert.equal(listed.body.data.stats.byStatus[stored.status] >= 1, true);
});

test("memory data comes from the real API contract", async () => {
  const created = await call("POST", "/memory", {
    headers: authorized,
    body: { text: "Prefers evidence-based status reports", category: "preference" },
  });
  assert.equal(created.status, 201);
  const memory = created.body.data.memory;
  assert.ok(memory.id);
  assert.equal(memory.category, "preference");
  assert.ok(memory.text);
  assert.ok(memory.createdAt);
  assert.ok(memory.updatedAt);

  const listed = await call("GET", "/memory", { query: { limit: "20" } });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.data.memories.some((item) => item.id === memory.id));
});

test("audit data comes from the real API contract", async () => {
  const response = await call("GET", "/audit", {
    headers: authorized,
    query: { limit: "50" },
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.data.events.length > 0);
  for (const event of response.body.data.events) {
    assert.ok(event.id);
    assert.ok(event.action);
    assert.ok(event.actor);
    assert.ok(event.at);
    assert.ok(event.outcome);
  }
  assert.equal(typeof response.body.data.stats.total, "number");
});

test("failed or unknown requests return structured errors, never fake records", async () => {
  const missingAgent = await call("GET", "/agents/not-a-real-agent");
  assert.equal(missingAgent.status, 404);
  assert.equal(missingAgent.body.ok, false);
  assert.equal(missingAgent.body.error.code, "UNKNOWN_AGENT");
  assert.equal(missingAgent.body.data, undefined);

  const unauthorizedAudit = await call("GET", "/audit");
  assert.equal(unauthorizedAudit.status, 403);
  assert.equal(unauthorizedAudit.body.data, undefined);
});

test("unknown or unverified agents are never GREEN", async () => {
  const configuredEnv = {
    ...process.env,
    GEMINI_API_KEY: "AIzaSyFAKE123456789012345678901234567",
  };
  const response = await call("GET", "/agents", { env: configuredEnv });
  assert.equal(response.status, 200);

  for (const agent of response.body.data.agents) {
    assert.equal(GATE_LABELS.has(agent.gate), true, `unexpected gate label: ${agent.gate}`);
  }

  const advisory = response.body.data.agents.find((agent) => agent.id === "coding");
  assert.equal(advisory.status, "requires_verification");
  assert.equal(advisory.gate, "NOT CONNECTED");
  assert.match(advisory.statusReason, /verification/i);

  const unknown = await call("GET", "/agents/ghost", { env: configuredEnv });
  assert.equal(unknown.status, 404);
  assert.notEqual(unknown.body.data?.agent?.gate, "GREEN");
});

test("NOT CONNECTED is reported for unconfigured integrations", async () => {
  const response = await call("GET", "/integrations");
  assert.equal(response.status, 200);
  const byId = Object.fromEntries(
    response.body.data.integrations.map((integration) => [integration.id, integration]),
  );

  assert.equal(byId.mt5_monitor.status, "not_connected");
  assert.equal(byId.binance_research.status, "not_connected");
  assert.equal(byId.whatsapp_business.status, "not_connected");
  assert.equal(byId.ai_provider.status, "not_connected");
  assert.deepEqual(byId.ai_provider.missingConfiguration, ["GEMINI_API_KEY"]);
});

test("APPROVAL REQUIRED is displayed and enforced without a control token", async () => {
  const agents = await call("GET", "/agents");
  const social = agents.body.data.agents.find((agent) => agent.id === "social_media");
  assert.equal(social.gate, "APPROVAL REQUIRED");

  const created = await call("POST", "/tasks", {
    body: { request: "publish a post on social media" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.task.status, "AWAITING_APPROVAL");

  const approve = await call("POST", `/tasks/${created.body.data.task.id}/approve`);
  assert.equal(approve.status, 403);
  assert.equal(approve.body.error.code, "APPROVAL_REQUIRED");
});

test("LOCKED actions cannot execute even with a valid control token", async () => {
  const response = await call("POST", "/tasks", {
    headers: authorized,
    body: { request: "withdraw funds from my account" },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "ACTION_LOCKED");
  assert.equal(response.body.data, undefined);
});

test("trading and money movement remain monitor-only and locked", async () => {
  const agents = await call("GET", "/agents");
  const trading = agents.body.data.agents.find((agent) => agent.id === "trading_monitor");
  assert.equal(trading.gate, "LOCKED");
  assert.equal(trading.permissions.financialActions, false);

  const posture = await call("GET", "/security/posture");
  const byAction = Object.fromEntries(
    posture.body.data.posture.lockedActions.map((item) => [item.action, item.status]),
  );
  assert.equal(byAction.real_trading, "LOCKED");
  assert.equal(byAction.money_movement, "LOCKED");
  assert.equal(byAction.mt5, "MONITOR ONLY");
  assert.equal(byAction.binance, "RESEARCH ONLY");
});

test("existing routes still respond and verification promotes advisory agents to GREEN", async () => {
  const routes = [
    "/status",
    "/agents",
    "/tasks",
    "/memory",
    "/integrations",
    "/notifications",
    "/security/posture",
  ];
  for (const route of routes) {
    const response = await call("GET", route);
    assert.equal(response.status, 200, `${route} must remain available`);
    assert.equal(response.body.ok, true);
  }

  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }],
    }),
  });
  const verifiedEnv = {
    ...process.env,
    GEMINI_API_KEY: "AIzaSyFAKE123456789012345678901234567",
  };

  const verification = await call("POST", "/integrations/ai_provider/test", {
    env: verifiedEnv,
    fetchImpl: fakeFetch,
  });
  assert.equal(verification.status, 200);
  assert.equal(verification.body.data.status, "ok");
  assert.equal(verification.body.data.performed, true);

  const status = await call("GET", "/status", { env: verifiedEnv });
  assert.equal(status.body.data.provider.verified, true);
  assert.ok(status.body.data.provider.verifiedAt);

  const agents = await call("GET", "/agents", { env: verifiedEnv });
  const coding = agents.body.data.agents.find((agent) => agent.id === "coding");
  assert.equal(coding.gate, "GREEN");
  assert.equal(coding.status, "advisory_ready");

  const blocked = agents.body.data.agents.find((agent) => agent.id === "whatsapp_assistant");
  assert.notEqual(blocked.gate, "GREEN");
});
