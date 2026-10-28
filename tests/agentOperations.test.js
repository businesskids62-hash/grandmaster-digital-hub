import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  assert.match(desk, /onClick=\{\(\) => loadCore\(\)\}/);
  assert.match(desk, /No substitute data is shown/);
});

test("Agent Desks memory requests use the signed session and are never persisted", () => {
  const desk = readSource("src/pages/AgentDesks.jsx");

  const loadCoreBlock = desk.slice(
    desk.indexOf("const loadCore"),
    desk.indexOf("useEffect("),
  );
  assert.equal(loadCoreBlock.includes('"/memory'), false);
  assert.equal(loadCoreBlock.includes("`/memory"), false);

  assert.match(desk, /request\(apiBase, "\/memory\?limit=50"\)/);
  assert.match(desk, /request\(apiBase, `\/memory\?\$\{params\.toString\(\)\}`\)/);
  assert.match(desk, /Memory is locked/);
  assert.match(desk, /disabled=\{busy === "memory-list"\}/);
  assert.equal(desk.includes("X-Grandmaster-Token"), false);
  assert.equal(desk.includes("token: token"), false);
  assert.doesNotMatch(desk, /(localStorage|sessionStorage)\.(setItem|getItem|removeItem)/);
});

test("Agent Desks relies on the signed session for every protected operation", () => {
  const desk = readSource("src/pages/AgentDesks.jsx");

  assert.match(desk, /request\(apiBase, "\/tasks\?limit=50"\)/);
  assert.match(desk, /request\(apiBase, "\/notifications"\)/);
  assert.match(
    desk,
    /request\(apiBase, "\/tasks", \{\s*method: "POST",\s*body:/,
  );
  assert.match(
    desk,
    /request\(apiBase, `\/tasks\/\$\{taskId\}\/\$\{action\}`, \{\s*method: "POST",\s*\}\)/,
  );
  assert.match(
    desk,
    /request\(apiBase, `\/integrations\/\$\{id\}\/test`, \{\s*method: "POST",\s*\}\)/,
  );
  assert.equal(desk.includes("GRANDMASTER_CONTROL_TOKEN"), true, "may only appear as explanatory copy");
  assert.equal(desk.includes("gm-control-token"), false, "no token input field");
  assert.doesNotMatch(desk, /(localStorage|sessionStorage)\.(setItem|getItem|removeItem)/);
});

test("task data comes from the real API contract", async () => {
  const created = await call("POST", "/tasks", {
    headers: authorized,
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

  const listed = await call("GET", "/tasks", {
    headers: authorized,
    query: { limit: "20" },
  });
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

  const listed = await call("GET", "/memory", {
    headers: authorized,
    query: { limit: "20" },
  });
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
  assert.equal(byId.notifications_in_app.lastVerifiedAt, null);
});

test("analytics reports the real storage mode and never claims durability", async () => {
  const moduleUrl = new URL("../lib/api/v1.js", import.meta.url).href;
  const childDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-analytics-"));
  const token = "analytics-control-token-1234567890";
  const script = `
    const { handleV1 } = await import(${JSON.stringify(moduleUrl)});
    const response = await handleV1({
      method: "POST",
      path: "/tasks",
      query: {},
      headers: {
        "x-grandmaster-token": ${JSON.stringify(token)},
        "x-request-id": "analytics-ephemeral-001",
      },
      body: { request: "analytics report of stored state", agentId: "analytics" },
      env: process.env,
      clientKey: "analytics-ephemeral-client",
    });
    const task = response.body?.data?.task || null;
    console.log(JSON.stringify({
      status: response.status,
      taskStatus: task?.status || null,
      result: task?.result || null,
    }));
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      env: {
        ...process.env,
        VERCEL: "1",
        GRANDMASTER_DATA_DIR: childDir,
        GRANDMASTER_CONTROL_TOKEN: token,
        GRANDMASTER_LOG_SILENT: "1",
        AI_PROVIDERS: "gemini:test-model",
      },
      encoding: "utf8",
    },
  );
  fs.rmSync(childDir, { recursive: true, force: true });

  assert.equal(child.status, 0, child.stderr || child.stdout);
  const payload = JSON.parse(child.stdout.trim().split(/\r?\n/).pop());
  assert.equal(payload.status, 201);
  assert.equal(payload.taskStatus, "COMPLETED");
  assert.equal(payload.result.data.durable, false);
  assert.equal(payload.result.data.storage, "ephemeral");
  assert.match(payload.result.data.source, /not durable/i);
});

test("APPROVAL REQUIRED is displayed and enforced without a control token", async () => {
  const agents = await call("GET", "/agents");
  const social = agents.body.data.agents.find((agent) => agent.id === "social_media");
  assert.equal(social.gate, "APPROVAL REQUIRED");

  const denied = await call("POST", "/tasks", {
    body: { request: "publish a post on social media" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "APPROVAL_REQUIRED");

  const created = await call("POST", "/tasks", {
    headers: authorized,
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

test("five desks expose honest evidence labels and real stored counts", async () => {
  const allowed = new Set([
    "LIVE VERIFIED",
    "LOCALLY TESTED",
    "VERIFIED IN CODE",
    "APPROVAL REQUIRED",
    "NOT CONNECTED",
    "NOT IMPLEMENTED",
    "MOCK/SIMULATED",
  ]);
  const response = await call("GET", "/agents");
  assert.equal(response.status, 200);
  assert.equal(response.body.data.desks.length, 5);

  for (const desk of response.body.data.desks) {
    assert.equal(allowed.has(desk.statusLabel), true, desk.id);
    assert.equal(desk.externalExecutionEnabled, false);
    assert.equal(desk.metricsSource, "local task store");
    assert.equal(typeof desk.taskCount, "number");
    assert.equal(desk.liveVerified, false, `${desk.id} must not claim live metrics`);
  }

  const byId = Object.fromEntries(
    response.body.data.desks.map((desk) => [desk.id, desk]),
  );
  assert.equal(byId.mt5_monitor.gate, "LOCKED");
  assert.equal(byId.social.statusLabel, "APPROVAL REQUIRED");
  assert.equal(byId.communications.statusLabel, "NOT CONNECTED");
  assert.equal(byId.risk_manager.statusLabel, "LOCALLY TESTED");
});

test("risk manager completes a read-only review and never executes", async () => {
  const response = await call("POST", "/tasks", {
    headers: authorized,
    body: {
      request: "risk review of the current task queue",
      agentId: "risk_manager",
    },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.task.status, "COMPLETED");
  assert.equal(response.body.data.task.result.data.verdict, "ALLOW");
  assert.equal(response.body.data.task.result.data.execution, false);
  assert.equal(response.body.data.task.result.data.externalActionsPerformed, false);
});

test("approval decisions record the request id without exposing the token", async () => {
  const created = await call("POST", "/tasks", {
    headers: { ...authorized, "x-request-id": "approval-create-001" },
    body: { request: "publish a post on social media about the launch" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.task.status, "AWAITING_APPROVAL");
  const taskId = created.body.data.task.id;

  const approved = await call("POST", `/tasks/${taskId}/approve`, {
    headers: { ...authorized, "x-request-id": "approval-decision-002" },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.task.approval.status, "approved");
  assert.equal(approved.body.data.task.approval.decidedBy, "control-token");
  assert.equal(
    approved.body.data.task.approval.requestId,
    "approval-decision-002",
  );

  const audit = await call("GET", "/audit", {
    headers: authorized,
    query: { limit: "100" },
  });
  const approvalEvent = audit.body.data.events.find(
    (event) => event.action === "task.approved" && event.taskId === taskId,
  );
  assert.ok(approvalEvent);
  assert.equal(approvalEvent.requestId, "approval-decision-002");
  assert.equal(JSON.stringify(audit.body).includes(TOKEN), false);
});

test("Agent Desks renders five desks and a token-gated approval inbox", () => {
  const desk = readSource("src/pages/AgentDesks.jsx");
  assert.match(desk, /Mission desks/);
  assert.match(desk, /Approval inbox/);
  assert.match(desk, /NO LIVE METRICS/);
  assert.match(desk, /LABEL_STYLE/);
  assert.match(desk, /taskAction\(task\.id, "approve"\)/);
  assert.match(desk, /VERIFIED · \$\{verifiedModel\}/);
  assert.doesNotMatch(
    desk,
    /(localStorage|sessionStorage)\.(setItem|getItem|removeItem)/,
  );
});

test("App health checks survive React StrictMode remount", () => {
  const app = readSource("src/App.jsx");
  assert.match(app, /useEffect\(\(\) => \{\s*mounted\.current = true;/);
});

test("existing routes still respond and verification promotes advisory agents to GREEN", async () => {
  const publicRoutes = ["/status", "/agents", "/integrations", "/security/posture"];
  for (const route of publicRoutes) {
    const response = await call("GET", route);
    assert.equal(response.status, 200, `${route} must remain available`);
    assert.equal(response.body.ok, true);
  }

  const protectedRoutes = ["/tasks", "/notifications"];
  for (const route of protectedRoutes) {
    const denied = await call("GET", route);
    assert.equal(denied.status, 403, `${route} must require authorization`);
    assert.equal(denied.body.error.code, "APPROVAL_REQUIRED");

    const allowed = await call("GET", route, { headers: authorized });
    assert.equal(allowed.status, 200, `${route} must work with authorization`);
    assert.equal(allowed.body.ok, true);
  }

  const deniedMemory = await call("GET", "/memory");
  assert.equal(deniedMemory.status, 403);
  assert.equal(deniedMemory.body.error.code, "APPROVAL_REQUIRED");

  const authorizedMemory = await call("GET", "/memory", {
    headers: authorized,
  });
  assert.equal(authorizedMemory.status, 200);
  assert.equal(authorizedMemory.body.ok, true);

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

  const verificationDenied = await call("POST", "/integrations/ai_provider/test", {
    env: verifiedEnv,
    fetchImpl: fakeFetch,
  });
  assert.equal(verificationDenied.status, 403);

  const verification = await call("POST", "/integrations/ai_provider/test", {
    env: verifiedEnv,
    fetchImpl: fakeFetch,
    headers: authorized,
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
