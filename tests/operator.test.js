import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-operator-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "operator-control-token-1234567890";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.GRANDMASTER_RATE_LIMIT_PER_MINUTE = "10000";
process.env.GRANDMASTER_OPERATOR_USERS = JSON.stringify({
  alice: "alice-operator-token-123456",
  bob: "bob-operator-token-1234567",
});
process.env.GRANDMASTER_OPERATOR_ALLOWED_HOSTS =
  "example.com,*.example.org,localhost,127.0.0.1";
process.env.GRANDMASTER_OPERATOR_ALLOW_LOOPBACK = "1";
process.env.GRANDMASTER_OPERATOR_BROWSER_CHANNEL = "msedge";
delete process.env.VERCEL;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;

const { handleV1 } = await import("../lib/api/v1.js");
const { resetOperatorState } = await import("../lib/operator/service.js");
const { operatorStore } = await import("../lib/operator/store.js");
const {
  validateNavigationUrl,
  validatePlan,
  hashPlan,
  APPROVAL_CONFIRMATION,
} = await import("../lib/operator/policy.js");
const {
  createBrowserDriver,
  resolveBrowserChannel,
  checkRedirect,
  assertInputSafe,
  assertClickSafe,
  detectBlockedPage,
} = await import("../lib/operator/driver.js");

const AUTH = {
  alice: { "x-grandmaster-operator-token": "alice-operator-token-123456" },
  bob: { "x-grandmaster-operator-token": "bob-operator-token-1234567" },
};
const CONTROL = { "x-grandmaster-token": "operator-control-token-1234567890" };
const APPROVE_BODY = { confirmation: APPROVAL_CONFIRMATION };

let sequence = 0;

async function call(method, requestPath, options = {}) {
  sequence += 1;
  return handleV1({
    method,
    path: requestPath,
    query: options.query || {},
    headers: { "x-request-id": `operator-request-${sequence}`, ...(options.headers || {}) },
    body: options.body,
    env: options.env || process.env,
    clientKey: `operator-client-${sequence}`,
    deps: options.deps || {},
  });
}

function driverError(code) {
  const error = new Error(`simulated ${code}`);
  error.code = code;
  error.status = code === "OPERATOR_TIMEOUT" ? 504 : 403;
  return error;
}

class FakeDriver {
  constructor({ snapshotResponse, perform } = {}) {
    this.calls = [];
    this.closed = false;
    this.snapshotResponse = snapshotResponse || {
      blocked: null,
      host: "example.com",
      title: "Example Dashboard",
      elements: [
        { ref: "gmop-0", tag: "input", type: "text", name: "Search", sensitive: false, disabled: false },
        { ref: "gmop-1", tag: "button", type: "button", name: "Search", sensitive: false, disabled: false },
        { ref: "gmop-2", tag: "input", type: "password", name: "Password", sensitive: true, disabled: false },
        { ref: "gmop-3", tag: "input", type: "file", name: "Attachment", sensitive: true, disabled: false },
        { ref: "gmop-4", tag: "button", type: "button", name: "Withdraw funds", sensitive: false, disabled: false },
        { ref: "gmop-5", tag: "a", type: null, name: "Account settings", sensitive: false, disabled: false },
      ],
    };
    this.perform =
      perform ||
      (async (action) => {
        if (action.ref === "gmop-2") assertInputSafe({ type: "password", name: "Password" });
        if (action.ref === "gmop-3") assertInputSafe({ type: "file", name: "Attachment" });
        if (action.ref === "gmop-4") assertClickSafe({ text: "Withdraw funds" });
        return { changeObserved: true, host: "example.com" };
      });
  }

  async navigate() {
    this.calls.push({ tool: "navigate" });
    return { host: "example.com", title: "Example Dashboard" };
  }

  async snapshot() {
    if (this.closed) throw driverError("OPERATOR_BROWSER_DISCONNECTED");
    this.calls.push({ tool: "snapshot" });
    return this.snapshotResponse;
  }

  async close() {
    this.closed = true;
  }
}

function makeFactory(options = {}) {
  const drivers = [];
  const factory = async () => {
    const driver = new FakeDriver(options);
    drivers.push(driver);
    return driver;
  };
  factory.drivers = drivers;
  return factory;
}

async function createSession(owner, factory, env = process.env) {
  const response = await call("POST", "/operator/sessions", {
    headers: AUTH[owner],
    deps: { driverFactory: factory },
    env,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.session;
}

const NAVIGATE_PLAN = { actions: [{ tool: "navigate", url: "https://example.com/dashboard" }] };
const CLICK_PLAN = { actions: [{ tool: "click", ref: "gmop-1" }] };

async function createRun(owner, sessionId, plan = CLICK_PLAN) {
  const response = await call("POST", "/operator/runs", {
    headers: AUTH[owner],
    body: { sessionId, plan },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.run;
}

async function approveRun(owner, run) {
  return call("POST", `/operator/runs/${run.id}/approve`, {
    headers: { ...AUTH[owner], ...CONTROL },
    body: { ...APPROVE_BODY, planHash: run.planHash },
  });
}

async function executeRun(owner, run) {
  return call("POST", `/operator/runs/${run.id}/execute`, { headers: AUTH[owner] });
}

beforeEach(async () => {
  await resetOperatorState();
});

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("operator credentials fail closed when missing, malformed or wrong", async () => {
  const notConfigured = await call("GET", "/operator/status", {
    headers: AUTH.alice,
    env: { ...process.env, GRANDMASTER_OPERATOR_USERS: "" },
  });
  assert.equal(notConfigured.status, 503);
  assert.equal(notConfigured.body.error.code, "OPERATOR_AUTH_NOT_CONFIGURED");

  const malformed = await call("GET", "/operator/status", {
    headers: AUTH.alice,
    env: { ...process.env, GRANDMASTER_OPERATOR_USERS: "{not-json" },
  });
  assert.equal(malformed.status, 503);
  assert.equal(malformed.body.error.code, "OPERATOR_AUTH_NOT_CONFIGURED");

  const missing = await call("GET", "/operator/status");
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, "OPERATOR_AUTH_REQUIRED");

  const invalid = await call("GET", "/operator/status", {
    headers: { "x-grandmaster-operator-token": "wrong-operator-token-123456" },
  });
  assert.equal(invalid.status, 403);
  assert.equal(invalid.body.error.code, "INVALID_OPERATOR_TOKEN");

  const controlAsOperator = await call("GET", "/operator/status", {
    headers: { "x-grandmaster-operator-token": "operator-control-token-1234567890" },
  });
  assert.equal(controlAsOperator.status, 403);
  assert.equal(controlAsOperator.body.error.code, "INVALID_OPERATOR_TOKEN");

  const status = await call("GET", "/operator/status", { headers: AUTH.alice });
  assert.equal(status.status, 200);
  assert.equal(status.body.data.operator.authConfigured, true);
  assert.equal(status.body.data.operator.realConnectorVerified, false);
  assert.equal(status.body.data.operator.integrationStatus, "not_connected");
});

test("serverless hosting fails closed before any browser work", async () => {
  let called = false;
  const factory = async () => {
    called = true;
    throw new Error("should not launch");
  };
  const response = await call("POST", "/operator/sessions", {
    headers: AUTH.alice,
    deps: { driverFactory: factory },
    env: { ...process.env, VERCEL: "1" },
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "OPERATOR_SERVERLESS_UNSUPPORTED");
  assert.equal(called, false);

  const lambda = await call("GET", "/operator/status", {
    headers: AUTH.alice,
    env: { ...process.env, AWS_LAMBDA_FUNCTION_NAME: "fn" },
  });
  assert.equal(lambda.status, 503);
  assert.equal(lambda.body.error.code, "OPERATOR_SERVERLESS_UNSUPPORTED");
});

test("missing host allowlist fails closed", async () => {
  const response = await call("POST", "/operator/sessions", {
    headers: AUTH.alice,
    deps: { driverFactory: makeFactory() },
    env: { ...process.env, GRANDMASTER_OPERATOR_ALLOWED_HOSTS: "" },
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, "OPERATOR_POLICY_NOT_CONFIGURED");
});

test("sessions are bound to an owner and cross-owner access is a 404", async () => {
  const factory = makeFactory();
  const session = await createSession("alice", factory);

  const own = await call("GET", `/operator/sessions/${session.id}`, { headers: AUTH.alice });
  assert.equal(own.status, 200);

  for (const [method, requestPath] of [
    ["GET", `/operator/sessions/${session.id}`],
    ["GET", `/operator/sessions/${session.id}/snapshot`],
    ["DELETE", `/operator/sessions/${session.id}`],
  ]) {
    const response = await call(method, requestPath, { headers: AUTH.bob });
    assert.equal(response.status, 404, `${method} ${requestPath}`);
    assert.equal(response.body.error.code, "OPERATOR_SESSION_NOT_FOUND");
  }

  const foreignRun = await call("POST", "/operator/runs", {
    headers: AUTH.bob,
    body: { sessionId: session.id, plan: CLICK_PLAN },
  });
  assert.equal(foreignRun.status, 404);
  assert.equal(foreignRun.body.error.code, "OPERATOR_SESSION_NOT_FOUND");

  const sessionCount = await call("GET", "/operator/status", { headers: AUTH.bob });
  assert.equal(sessionCount.body.data.operator.sessions, 0);
});

test("unsafe schemes, hosts, ports, credentials and redirects are rejected", () => {
  const cases = [
    ["http://example.com/", "OPERATOR_URL_HTTPS_REQUIRED"],
    ["javascript:alert(1)", "OPERATOR_URL_SCHEME_BLOCKED"],
    ["file:///etc/passwd", "OPERATOR_URL_SCHEME_BLOCKED"],
    ["data:text/html,hello", "OPERATOR_URL_SCHEME_BLOCKED"],
    ["https://user:pass@example.com/", "OPERATOR_URL_CREDENTIALS_BLOCKED"],
    ["https://192.168.1.10/", "OPERATOR_URL_IP_BLOCKED"],
    ["https://example.com:8443/", "OPERATOR_URL_PORT_BLOCKED"],
    ["https://evil.test/", "OPERATOR_URL_HOST_NOT_ALLOWED"],
    ["https://example.com.evil.test/", "OPERATOR_URL_HOST_NOT_ALLOWED"],
    ["https://evil-example.com/", "OPERATOR_URL_HOST_NOT_ALLOWED"],
  ];
  for (const [url, code] of cases) {
    const result = validateNavigationUrl(url, process.env);
    assert.equal(result.ok, false, url);
    assert.equal(result.code, code, url);
  }

  assert.equal(validateNavigationUrl("https://example.com/dashboard", process.env).ok, true);
  assert.equal(validateNavigationUrl("https://sub.example.org/page", process.env).ok, true);

  const loopback = validateNavigationUrl("http://127.0.0.1:5100/", process.env);
  assert.equal(loopback.ok, true);
  assert.equal(loopback.loopback, true);

  const loopbackDisabled = validateNavigationUrl("http://127.0.0.1:5100/", {
    ...process.env,
    GRANDMASTER_OPERATOR_ALLOW_LOOPBACK: "0",
  });
  assert.equal(loopbackDisabled.ok, false);
  assert.equal(loopbackDisabled.code, "OPERATOR_URL_LOOPBACK_BLOCKED");

  assert.throws(
    () => checkRedirect("https://evil.test/", process.env),
    (error) => error.code === "OPERATOR_REDIRECT_BLOCKED",
  );
  assert.equal(checkRedirect("https://example.com/next", process.env).host, "example.com");
});

test("navigation policy is enforced through the API", async () => {
  const factory = makeFactory();
  const session = await createSession("alice", factory);

  const response = await call("POST", "/operator/runs", {
    headers: AUTH.alice,
    body: {
      sessionId: session.id,
      plan: { actions: [{ tool: "navigate", url: "http://example.com/" }] },
    },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "OPERATOR_URL_HTTPS_REQUIRED");
  assert.equal(factory.drivers[0].calls.length, 0);
});

test("unknown tools, oversized plans and oversized values are rejected", async () => {
  const factory = makeFactory();
  const session = await createSession("alice", factory);

  const upload = await call("POST", "/operator/runs", {
    headers: AUTH.alice,
    body: { sessionId: session.id, plan: { actions: [{ tool: "execute_script", ref: "gmop-1" }] } },
  });
  assert.equal(upload.status, 403);
  assert.equal(upload.body.error.code, "OPERATOR_ACTION_PROHIBITED");

  const unknown = await call("POST", "/operator/runs", {
    headers: AUTH.alice,
    body: { sessionId: session.id, plan: { actions: [{ tool: "hack", ref: "gmop-1" }] } },
  });
  assert.equal(unknown.status, 403);
  assert.equal(unknown.body.error.code, "OPERATOR_UNKNOWN_TOOL");

  const tooMany = await call("POST", "/operator/runs", {
    headers: AUTH.alice,
    body: {
      sessionId: session.id,
      plan: { actions: Array.from({ length: 13 }, () => ({ tool: "wait", ms: 100 })) },
    },
  });
  assert.equal(tooMany.status, 413);
  assert.equal(tooMany.body.error.code, "OPERATOR_PLAN_TOO_LARGE");

  const hugeValue = await call("POST", "/operator/runs", {
    headers: AUTH.alice,
    body: {
      sessionId: session.id,
      plan: { actions: [{ tool: "fill", ref: "gmop-0", value: "x".repeat(501) }] },
    },
  });
  assert.equal(hugeValue.status, 413);
  assert.equal(hugeValue.body.error.code, "OPERATOR_VALUE_TOO_LARGE");

  const badRef = await call("POST", "/operator/runs", {
    headers: AUTH.alice,
    body: { sessionId: session.id, plan: { actions: [{ tool: "click", ref: "#submit" }] } },
  });
  assert.equal(badRef.status, 403);
  assert.equal(badRef.body.error.code, "OPERATOR_INVALID_TARGET");
});

test("financial intent is blocked at planning and unsafe elements at execution", async () => {
  assert.throws(
    () => assertInputSafe({ type: "password", name: "Password" }),
    (error) => error.code === "OPERATOR_SENSITIVE_INPUT_BLOCKED",
  );
  assert.throws(
    () => assertInputSafe({ type: "file", name: "Attachment" }),
    (error) => error.code === "OPERATOR_SENSITIVE_INPUT_BLOCKED",
  );
  assert.throws(
    () => assertInputSafe({ type: "text", name: "cardNumber" }),
    (error) => error.code === "OPERATOR_SENSITIVE_INPUT_BLOCKED",
  );
  assert.throws(
    () => assertClickSafe({ text: "Withdraw funds" }),
    (error) => error.code === "OPERATOR_ACTION_PROHIBITED",
  );
  assert.doesNotThrow(() => assertClickSafe({ text: "Search" }));

  const factory = makeFactory();
  const session = await createSession("alice", factory);

  const financial = await call("POST", "/operator/runs", {
    headers: AUTH.alice,
    body: {
      sessionId: session.id,
      plan: { actions: [{ tool: "fill", ref: "gmop-0", value: "withdraw funds now" }] },
    },
  });
  assert.equal(financial.status, 403);
  assert.equal(financial.body.error.code, "OPERATOR_FINANCIAL_ACTION_BLOCKED");

  for (const [ref, code] of [
    ["gmop-2", "OPERATOR_SENSITIVE_INPUT_BLOCKED"],
    ["gmop-3", "OPERATOR_SENSITIVE_INPUT_BLOCKED"],
    ["gmop-4", "OPERATOR_ACTION_PROHIBITED"],
  ]) {
    const run = await createRun("alice", session.id, { actions: [{ tool: "click", ref }] });
    assert.equal((await approveRun("alice", run)).status, 200);
    const executed = await executeRun("alice", run);
    assert.equal(executed.status, 200);
    assert.equal(executed.body.data.run.status, "BLOCKED", ref);
    assert.equal(executed.body.data.run.error.code, code, ref);
  }
});

test("plan hashes are canonical and approvals require two separate credentials", async () => {
  const first = validatePlan(
    { actions: [{ tool: "click", ref: "gmop-1" }, { tool: "wait", ms: 100 }] },
    process.env,
  );
  const second = validatePlan(
    { actions: [{ ref: "gmop-1", tool: "click" }, { ms: 100, tool: "wait" }] },
    process.env,
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.hash, hashPlan(first.plan));
  assert.equal(first.hash, second.hash);

  const changed = validatePlan(
    { actions: [{ tool: "click", ref: "gmop-1" }, { tool: "wait", ms: 500 }] },
    process.env,
  );
  assert.notEqual(first.hash, changed.hash);

  const factory = makeFactory();
  const session = await createSession("alice", factory);
  const run = await createRun("alice", session.id);

  const operatorOnly = await call("POST", `/operator/runs/${run.id}/approve`, {
    headers: AUTH.alice,
    body: { ...APPROVE_BODY, planHash: run.planHash },
  });
  assert.equal(operatorOnly.status, 403);
  assert.equal(operatorOnly.body.error.code, "APPROVAL_REQUIRED");

  const controlOnly = await call("POST", `/operator/runs/${run.id}/approve`, {
    headers: CONTROL,
    body: { ...APPROVE_BODY, planHash: run.planHash },
  });
  assert.equal(controlOnly.status, 401);
  assert.equal(controlOnly.body.error.code, "OPERATOR_AUTH_REQUIRED");

  const noConfirmation = await call("POST", `/operator/runs/${run.id}/approve`, {
    headers: { ...AUTH.alice, ...CONTROL },
    body: { planHash: run.planHash },
  });
  assert.equal(noConfirmation.status, 400);
  assert.equal(noConfirmation.body.error.code, "OPERATOR_CONFIRMATION_REQUIRED");

  const wrongHash = await call("POST", `/operator/runs/${run.id}/approve`, {
    headers: { ...AUTH.alice, ...CONTROL },
    body: { ...APPROVE_BODY, planHash: "0".repeat(64) },
  });
  assert.equal(wrongHash.status, 409);
  assert.equal(wrongHash.body.error.code, "OPERATOR_PLAN_HASH_MISMATCH");

  const approved = await approveRun("alice", run);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.run.status, "APPROVED");

  const replay = await approveRun("alice", run);
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error.code, "OPERATOR_APPROVAL_REPLAY");
});

test("execution requires approval, is single-use, expires and detects hash changes", async () => {
  const factory = makeFactory();
  const session = await createSession("alice", factory);

  const unapproved = await createRun("alice", session.id);
  const denied = await executeRun("alice", unapproved);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "OPERATOR_APPROVAL_REQUIRED");

  const expiring = await createRun("alice", session.id);
  assert.equal((await approveRun("alice", expiring)).status, 200);
  operatorStore.getRun(expiring.id).approval.expiresAt = new Date(Date.now() - 1000).toISOString();
  const expired = await executeRun("alice", expiring);
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error.code, "OPERATOR_APPROVAL_EXPIRED");

  const tampered = await createRun("alice", session.id);
  assert.equal((await approveRun("alice", tampered)).status, 200);
  operatorStore.getRun(tampered.id).planHash = "0".repeat(64);
  const changed = await executeRun("alice", tampered);
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, "OPERATOR_PLAN_CHANGED");

  const completed = await createRun("alice", session.id);
  assert.equal((await approveRun("alice", completed)).status, 200);
  const executed = await executeRun("alice", completed);
  assert.equal(executed.status, 200);
  assert.equal(executed.body.data.run.status, "COMPLETED");
  assert.equal(executed.body.data.run.result.changeObserved, true);

  const replay = await executeRun("alice", completed);
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error.code, "OPERATOR_APPROVAL_REPLAY");
});

test("no observed change, timeout and browser disconnect never claim success", async () => {
  const noChange = makeFactory({ perform: async () => ({ changeObserved: false }) });
  const noChangeSession = await createSession("alice", noChange);
  const noChangeRun = await createRun("alice", noChangeSession.id);
  assert.equal((await approveRun("alice", noChangeRun)).status, 200);
  const noChangeResult = await executeRun("alice", noChangeRun);
  assert.equal(noChangeResult.body.data.run.status, "FAILED");
  assert.equal(noChangeResult.body.data.run.error.code, "OPERATOR_NO_CHANGE_OBSERVED");
  assert.equal(noChangeResult.body.data.run.result, null);

  const timeout = makeFactory({
    perform: async () => {
      throw driverError("OPERATOR_TIMEOUT");
    },
  });
  const timeoutSession = await createSession("alice", timeout);
  const timeoutRun = await createRun("alice", timeoutSession.id);
  assert.equal((await approveRun("alice", timeoutRun)).status, 200);
  const timeoutResult = await executeRun("alice", timeoutRun);
  assert.equal(timeoutResult.body.data.run.status, "FAILED");
  assert.equal(timeoutResult.body.data.run.error.code, "OPERATOR_TIMEOUT");

  const disconnect = makeFactory({
    perform: async () => {
      throw driverError("OPERATOR_BROWSER_DISCONNECTED");
    },
  });
  const disconnectSession = await createSession("alice", disconnect);
  const disconnectRun = await createRun("alice", disconnectSession.id);
  assert.equal((await approveRun("alice", disconnectRun)).status, 200);
  const disconnectResult = await executeRun("alice", disconnectRun);
  assert.equal(disconnectResult.body.data.run.status, "FAILED");
  assert.equal(disconnectResult.body.data.run.error.code, "OPERATOR_BROWSER_DISCONNECTED");

  const gone = await call("GET", `/operator/sessions/${disconnectSession.id}`, {
    headers: AUTH.alice,
  });
  assert.equal(gone.status, 404);
});

test("CAPTCHA and login walls stop in a BLOCKED state", async () => {
  assert.equal(
    detectBlockedPage({ text: "Please complete the reCAPTCHA challenge." }),
    "OPERATOR_CAPTCHA_DETECTED",
  );
  assert.equal(
    detectBlockedPage({ hasPassword: true, path: "/login" }),
    "OPERATOR_LOGIN_WALL",
  );
  assert.equal(detectBlockedPage({ hasPassword: true, path: "/settings", text: "" }), null);

  const captchaFactory = makeFactory({
    perform: async () => ({ blocked: "OPERATOR_CAPTCHA_DETECTED" }),
  });
  const captchaSession = await createSession("alice", captchaFactory);
  const captchaRun = await createRun("alice", captchaSession.id);
  assert.equal((await approveRun("alice", captchaRun)).status, 200);
  const captchaResult = await executeRun("alice", captchaRun);
  assert.equal(captchaResult.body.data.run.status, "BLOCKED");
  assert.equal(captchaResult.body.data.run.error.code, "OPERATOR_CAPTCHA_DETECTED");

  const loginFactory = makeFactory({
    perform: async () => ({ blocked: "OPERATOR_LOGIN_WALL" }),
    snapshotResponse: {
      blocked: "OPERATOR_LOGIN_WALL",
      host: "example.com",
      title: "Sign in",
      elements: [{ ref: "gmop-0", tag: "input", type: "password", name: "Password" }],
    },
  });
  const loginSession = await createSession("alice", loginFactory);
  const loginRun = await createRun("alice", loginSession.id);
  assert.equal((await approveRun("alice", loginRun)).status, 200);
  const loginResult = await executeRun("alice", loginRun);
  assert.equal(loginResult.body.data.run.status, "BLOCKED");
  assert.equal(loginResult.body.data.run.error.code, "OPERATOR_LOGIN_WALL");

  const blockedSnapshot = await call(
    "GET",
    `/operator/sessions/${loginSession.id}/snapshot`,
    { headers: AUTH.alice },
  );
  assert.equal(blockedSnapshot.status, 200);
  assert.equal(blockedSnapshot.body.data.snapshot.blocked, true);
  assert.equal(blockedSnapshot.body.data.snapshot.reason, "OPERATOR_LOGIN_WALL");
  assert.deepEqual(blockedSnapshot.body.data.snapshot.elements, []);

  const factory = makeFactory({
    snapshotResponse: {
      blocked: "OPERATOR_CAPTCHA_DETECTED",
      host: "example.com",
      title: "Verify",
      elements: [{ ref: "gmop-0", tag: "input", type: "text", name: "x" }],
    },
  });
  const session = await createSession("alice", factory);
  const snapshot = await call("GET", `/operator/sessions/${session.id}/snapshot`, {
    headers: AUTH.alice,
  });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.data.snapshot.blocked, true);
  assert.equal(snapshot.body.data.snapshot.reason, "OPERATOR_CAPTCHA_DETECTED");
  assert.deepEqual(snapshot.body.data.snapshot.elements, []);
});

test("typed values and secrets never appear in responses, snapshots or audit", async () => {
  const secret = "SuperSecretValue123";
  const factory = makeFactory();
  const session = await createSession("alice", factory);

  const run = await createRun("alice", session.id, {
    actions: [{ tool: "fill", ref: "gmop-0", value: secret }],
  });
  assert.equal(JSON.stringify(run).includes(secret), false);
  assert.equal(run.actions[0].value, "[redacted]");

  const approved = await approveRun("alice", run);
  assert.equal(JSON.stringify(approved.body).includes(secret), false);

  const executed = await executeRun("alice", run);
  assert.equal(JSON.stringify(executed.body).includes(secret), false);
  assert.equal(JSON.stringify(executed.body).includes("alice-operator-token"), false);
  assert.equal(JSON.stringify(executed.body).includes("operator-control-token"), false);

  const snapshot = await call("GET", `/operator/sessions/${session.id}/snapshot`, {
    headers: AUTH.alice,
  });
  const passwordElement = snapshot.body.data.snapshot.elements.find(
    (element) => element.type === "password",
  );
  assert.equal(passwordElement.sensitive, true);
  assert.equal("value" in passwordElement, false);
  assert.equal(JSON.stringify(snapshot.body).includes(secret), false);

  const audit = await call("GET", "/audit", { headers: CONTROL });
  assert.equal(audit.status, 200);
  const auditText = JSON.stringify(audit.body);
  assert.equal(auditText.includes(secret), false);
  assert.equal(auditText.includes("alice-operator-token"), false);
  assert.equal(auditText.includes("operator-control-token"), false);
  assert.equal(auditText.includes("SuperSecret"), false);
});

test("the operator enforces per-owner session limits", async () => {
  const env = { ...process.env, GRANDMASTER_OPERATOR_MAX_SESSIONS: "1" };
  const factory = makeFactory();
  await createSession("alice", factory, env);
  const second = await call("POST", "/operator/sessions", {
    headers: AUTH.alice,
    deps: { driverFactory: factory },
    env,
  });
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, "OPERATOR_SESSION_LIMIT");
});

test("missing playwright and unavailable browsers fail closed", async () => {
  assert.throws(
    () => resolveBrowserChannel({ GRANDMASTER_OPERATOR_BROWSER_CHANNEL: "firefox" }),
    (error) => error.code === "OPERATOR_BROWSER_CHANNEL_INVALID",
  );
  assert.equal(resolveBrowserChannel({}), "msedge");

  await assert.rejects(
    () =>
      createBrowserDriver({
        env: { GRANDMASTER_OPERATOR_BROWSER_CHANNEL: "msedge" },
        moduleLoader: async () => {
          throw new Error("module not found");
        },
      }),
    (error) => error.code === "OPERATOR_PLAYWRIGHT_UNAVAILABLE",
  );

  await assert.rejects(
    () =>
      createBrowserDriver({
        env: { GRANDMASTER_OPERATOR_BROWSER_CHANNEL: "msedge" },
        moduleLoader: async () => ({
          chromium: {
            launch: async () => {
              throw new Error("browser missing");
            },
          },
        }),
      }),
    (error) => error.code === "OPERATOR_BROWSER_UNAVAILABLE",
  );
});

test("registry, posture and existing agent contracts stay honest", async () => {
  const integrations = await call("GET", "/integrations");
  assert.equal(integrations.status, 200);
  const operator = integrations.body.data.integrations.find(
    (item) => item.id === "browser_operator",
  );
  assert.ok(operator);
  assert.equal(operator.status, "not_connected");
  assert.equal(operator.detail.realConnectorVerified, false);
  assert.ok(operator.error.length > 0);

  const posture = await call("GET", "/security/posture");
  const byAction = Object.fromEntries(
    posture.body.data.posture.lockedActions.map((item) => [item.action, item.status]),
  );
  assert.equal(byAction.browser_operator, "APPROVAL REQUIRED");
  assert.equal(byAction.desktop_control, "LOCKED");
  assert.equal(byAction.captcha_solving, "LOCKED");
  assert.equal(byAction.real_trading, "LOCKED");
  assert.equal(byAction.mt5, "MONITOR ONLY");

  const agents = await call("GET", "/agents");
  assert.equal(agents.body.data.count, 21);
  assert.equal(agents.body.data.desks.length, 5);

  const status = await call("GET", "/status");
  assert.equal(status.body.data.operator.configured, true);
  assert.equal(status.body.data.operator.realConnectorVerified, false);
  assert.equal(status.body.data.operator.serverless, false);
});
