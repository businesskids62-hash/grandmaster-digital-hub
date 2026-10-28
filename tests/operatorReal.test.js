import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENABLED = process.env.GRANDMASTER_OPERATOR_REAL_TEST === "1";
const OWNER_ID = "real-owner";
const OPERATOR_TOKEN = "real-operator-token-0123456789";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-operator-real-"));

process.env.GRANDMASTER_DATA_DIR = tempDir;
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.GRANDMASTER_RATE_LIMIT_PER_MINUTE = "1000";
process.env.GRANDMASTER_CONTROL_TOKEN = "real-control-token-0123456789";
process.env.GRANDMASTER_OPERATOR_USERS = JSON.stringify({ [OWNER_ID]: OPERATOR_TOKEN });
process.env.GRANDMASTER_OPERATOR_ALLOWED_HOSTS = "127.0.0.1";
process.env.GRANDMASTER_OPERATOR_ALLOW_LOOPBACK = "1";
process.env.GRANDMASTER_OPERATOR_TIMEOUT_MS = "10000";

const {
  createOperatorSession,
  createOperatorRun,
  approveOperatorRun,
  executeOperatorRun,
  getOperatorSnapshot,
  closeOperatorSession,
  getOperatorStatus,
} = await import("../lib/operator/service.js");
const { operatorStore } = await import("../lib/operator/store.js");
const {
  recordConnectorVerification,
  getConnectorVerification,
} = await import("../lib/operator/verification.js");

let fixture = null;
let sessionId = null;
let driver = null;

function html(title, body) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
${body}
</body>
</html>`;
}

const HOME_BODY = `
<h1>Fixture Home</h1>
<p>Local synthetic fixture. Not a real account or website.</p>
<button id="increment" name="Increment">Increment</button>
<p id="count" role="status" aria-label="Count output">Clicks: none</p>
<label>Name <input id="name" name="Name" placeholder="Name"></label>
<p id="echo" role="status" aria-label="Echo output">Hello</p>
<label>Choice <select id="choice" name="Choice">
  <option value="one">One</option>
  <option value="two">Two</option>
</select></label>
<p id="choice-out" role="status" aria-label="Choice output">Choice: one</p>
<a href="/second">Second page</a>
<input type="password" name="Password" placeholder="Password">
<input type="file" name="Upload">
<button id="withdraw" name="Withdraw">Withdraw</button>
<script>
  let count = 0;
  document.getElementById('increment').addEventListener('click', () => {
    count += 1;
    document.getElementById('count').textContent = 'Clicks: ' + count;
  });
  document.getElementById('name').addEventListener('input', (event) => {
    document.getElementById('echo').textContent = 'Hello ' + event.target.value;
  });
  document.getElementById('choice').addEventListener('change', (event) => {
    document.getElementById('choice-out').textContent =
      'Selected option ' + (event.target.selectedIndex + 1);
  });
</script>
`;

const SECOND_BODY = `
<h1>Second page</h1>
<p>Navigation inside the loopback fixture worked.</p>
<button name="Second action">Second action</button>
`;

const CAPTCHA_BODY = `
<h1>Robot check</h1>
<p>Please complete the CAPTCHA to continue.</p>
<input type="password" name="Password" placeholder="Password">
`;

async function startFixture() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const send = (status, title, body) => {
      response.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(html(title, body));
    };
    if (url.pathname === "/second") return send(200, "Fixture Second", SECOND_BODY);
    if (url.pathname === "/captcha") return send(200, "Robot check", CAPTCHA_BODY);
    if (url.pathname === "/slow") {
      // Never responds within the configured operator timeout.
      const timer = setTimeout(() => send(200, "Slow page", "<h1>Slow page</h1>"), 25_000);
      response.on("close", () => clearTimeout(timer));
      return undefined;
    }
    if (url.pathname === "/") return send(200, "Fixture Home", HOME_BODY);
    return send(404, "Not found", "<h1>Not found</h1>");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(address.address, "127.0.0.1");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function openSession() {
  const preferred = String(
    process.env.GRANDMASTER_OPERATOR_BROWSER_CHANNEL || "msedge",
  ).toLowerCase();
  const channels = preferred === "chrome" ? ["chrome", "msedge"] : ["msedge", "chrome"];
  let lastError = null;
  for (const channel of channels) {
    process.env.GRANDMASTER_OPERATOR_BROWSER_CHANNEL = channel;
    try {
      const session = await createOperatorSession({
        env: process.env,
        ownerId: OWNER_ID,
        requestId: "real-test-session",
      });
      sessionId = session.id;
      driver = operatorStore.getSession(sessionId)?.driver || null;
      return;
    } catch (error) {
      lastError = error;
      if (
        error?.code !== "OPERATOR_BROWSER_UNAVAILABLE" &&
        error?.code !== "OPERATOR_BROWSER_CHANNEL_INVALID"
      ) {
        break;
      }
    }
  }
  assert.ok(
    sessionId,
    `A supported local browser could not be launched: ${lastError?.code || lastError?.message || "unknown"}`,
  );
}

async function runPlan(actions) {
  const created = await createOperatorRun({
    env: process.env,
    ownerId: OWNER_ID,
    sessionId,
    plan: { version: 1, actions },
    requestId: "real-test-plan",
  });
  assert.match(created.planHash, /^[a-f0-9]{64}$/);
  const approved = await approveOperatorRun({
    env: process.env,
    ownerId: OWNER_ID,
    runId: created.id,
    planHash: created.planHash,
    confirmation: "APPROVE",
    requestId: "real-test-approve",
  });
  assert.equal(approved.status, "APPROVED");
  return executeOperatorRun({
    env: process.env,
    ownerId: OWNER_ID,
    runId: created.id,
    requestId: "real-test-execute",
  });
}

async function snapshot() {
  return getOperatorSnapshot({
    env: process.env,
    ownerId: OWNER_ID,
    sessionId,
    requestId: "real-test-snapshot",
  });
}

function refFor(snap, name) {
  const element = snap.elements.find((item) => item.name === name);
  assert.ok(element, `Snapshot did not expose the expected "${name}" element.`);
  return element.ref;
}

before(async () => {
  if (!ENABLED) return;
  assert.equal(typeof createOperatorSession, "function");
  fixture = await startFixture();
});

after(async () => {
  if (ENABLED) {
    if (sessionId) {
      await closeOperatorSession({
        env: process.env,
        ownerId: OWNER_ID,
        sessionId,
        requestId: "real-test-close",
      }).catch(() => {});
    }
    if (fixture?.server) {
      fixture.server.closeAllConnections?.();
      await new Promise((resolve) => fixture.server.close(resolve));
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("real connector test requires explicit opt-in", (t) => {
  if (ENABLED) {
    t.skip("opt-in enabled; the real connector suite runs instead");
    return;
  }
  assert.fail(
    "Refused to run: this test launches a real local browser. Set GRANDMASTER_OPERATOR_REAL_TEST=1 and run npm run test:operator:real.",
  );
});

test("real Playwright connector drives a loopback fixture", { skip: !ENABLED }, async (t) => {
  await openSession();
  assert.ok(driver, "The browser driver was not created.");
  assert.match(driver.channel, /^(msedge|chrome)$/);
  assert.ok(driver.browserVersion && driver.browserVersion !== "unknown");
  t.diagnostic(
    `browser=${driver.channel} version=${driver.browserVersion} timeoutMs=${driver.timeoutMs}`,
  );

  const base = fixture.baseUrl;

  const blank = await snapshot();
  assert.equal(blank.host, null);
  assert.equal(blank.elements.length, 0);
  assert.equal(blank.blocked, false);
  t.diagnostic("fresh session snapshot verified: about:blank is not treated as a redirect");

  const opened = await runPlan([{ tool: "navigate", url: `${base}/` }]);
  assert.equal(
    opened.status,
    "COMPLETED",
    `Initial navigation did not complete: ${opened.error?.code || "unknown"} ${opened.error?.message || ""}`,
  );
  assert.equal(opened.result?.host, "127.0.0.1");
  t.diagnostic("navigation verified: loopback fixture opened");

  const home = await snapshot();
  assert.equal(home.host, "127.0.0.1");
  assert.equal(home.title, "Fixture Home");
  assert.equal(home.blocked, false);
  assert.ok(home.elements.length > 0);
  for (const element of home.elements) {
    assert.match(element.ref, /^gmop-\d{1,3}$/);
  }
  const incrementRef = refFor(home, "Increment");
  const nameRef = refFor(home, "Name");
  const choiceRef = refFor(home, "Choice");
  const passwordRef = refFor(home, "Password");
  const passwordElement = home.elements.find((item) => item.ref === passwordRef);
  assert.equal(passwordElement.sensitive, true);
  t.diagnostic("snapshot verified: numbered refs and sensitive fields identified");

  const actions = await runPlan([
    { tool: "click", ref: incrementRef },
    { tool: "fill", ref: nameRef, value: "Ada" },
    { tool: "select", ref: choiceRef, value: "two" },
  ]);
  assert.equal(
    actions.status,
    "COMPLETED",
    `Safe click/type/select plan did not complete: ${actions.error?.code || "unknown"} ${actions.error?.message || ""}`,
  );
  assert.equal(actions.result?.changeObserved, true);
  assert.deepEqual(
    actions.steps.map((step) => step.tool),
    ["click", "fill", "select"],
  );
  assert.deepEqual(
    actions.steps.map((step) => step.changeObserved),
    [true, true, true],
  );

  const after = await snapshot();
  const live = operatorStore.getSession(sessionId);
  const countRead = await live.driver.perform({
    tool: "read",
    ref: refFor(after, "Count output"),
  });
  const echoRead = await live.driver.perform({
    tool: "read",
    ref: refFor(after, "Echo output"),
  });
  const choiceRead = await live.driver.perform({
    tool: "read",
    ref: refFor(after, "Choice output"),
  });
  assert.match(countRead.observedText, /Clicks: 1/);
  assert.match(echoRead.observedText, /Hello Ada/);
  assert.match(choiceRead.observedText, /Selected option 2/);
  t.diagnostic("DOM changes verified: click, type and select all observed");

  const second = await runPlan([{ tool: "navigate", url: `${base}/second` }]);
  assert.equal(second.status, "COMPLETED");
  const secondSnap = await snapshot();
  assert.equal(secondSnap.title, "Fixture Second");
  t.diagnostic("navigation between fixture pages verified");

  const back = await runPlan([{ tool: "navigate", url: `${base}/` }]);
  assert.equal(back.status, "COMPLETED");
  const backSnap = await snapshot();
  const withdrawRefBack = refFor(backSnap, "Withdraw");
  const passwordRefBack = refFor(backSnap, "Password");

  const unsafe = await runPlan([{ tool: "click", ref: withdrawRefBack }]);
  assert.equal(unsafe.status, "BLOCKED", "Unsafe click was not blocked.");
  assert.equal(unsafe.error?.code, "OPERATOR_ACTION_PROHIBITED");
  t.diagnostic("unsafe-target rejection verified: destructive click blocked");

  const sensitive = await runPlan([
    { tool: "fill", ref: passwordRefBack, value: "dummy-value" },
  ]);
  assert.equal(sensitive.status, "BLOCKED", "Password input was not blocked.");
  assert.equal(sensitive.error?.code, "OPERATOR_SENSITIVE_INPUT_BLOCKED");
  t.diagnostic("sensitive-input rejection verified: password field blocked");

  const captcha = await runPlan([{ tool: "navigate", url: `${base}/captcha` }]);
  assert.equal(captcha.status, "BLOCKED", "CAPTCHA page was not blocked.");
  assert.equal(captcha.error?.code, "OPERATOR_CAPTCHA_DETECTED");
  t.diagnostic("BLOCKED handling verified: CAPTCHA stop without solving");

  const timeout = await runPlan([{ tool: "navigate", url: `${base}/slow` }]);
  assert.equal(timeout.status, "FAILED", "Timeout did not fail the run.");
  assert.equal(timeout.error?.code, "OPERATOR_TIMEOUT");
  t.diagnostic("timeout handling verified: run FAILED without success claim");

  await driver.close();
  await assert.rejects(
    () =>
      getOperatorSnapshot({
        env: process.env,
        ownerId: OWNER_ID,
        sessionId,
        requestId: "real-test-snapshot-after-close",
      }),
    (error) => error?.code === "OPERATOR_BROWSER_DISCONNECTED",
  );
  t.diagnostic("disconnect handling verified: closed browser fails closed");

  // Evidence goes to the server's data directory, never to Git. Only the
  // browser channel, version and timestamp are stored — no page data.
  const evidenceEnv = { ...process.env, GRANDMASTER_DATA_DIR: "" };
  const recorded = recordConnectorVerification({
    browser: driver.channel,
    browserVersion: driver.browserVersion,
    env: evidenceEnv,
  });
  const marker = getConnectorVerification(evidenceEnv);
  assert.equal(marker?.browser, driver.channel);
  assert.equal(marker?.browserVersion, driver.browserVersion);
  assert.equal(marker?.fixture, "loopback");
  const status = getOperatorStatus(evidenceEnv, OWNER_ID);
  assert.equal(status.realConnectorVerified, true);
  assert.equal(status.integrationStatus, "connected");
  t.diagnostic(
    `verification recorded at ${new Date(recorded.verifiedAt).toISOString()} for ${recorded.browser}`,
  );
});
