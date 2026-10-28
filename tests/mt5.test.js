import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-mt5-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "test-control-token-1234567890";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.AI_PROVIDERS = "gemini:test-model";
delete process.env.MT5_BRIDGE_URL;
delete process.env.GEMINI_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

const { handleV1 } = await import("../lib/api/v1.js");
const { getMt5Status, readMt5Snapshot } = await import("../lib/integrations/mt5Bridge.js");
const { getIntegrations } = await import("../lib/integrations/registry.js");
const { getSecurityPosture } = await import("../lib/security/posture.js");

const TOKEN = "test-control-token-1234567890";
const authorized = { "x-grandmaster-token": TOKEN };
let sequence = 0;

function envWith(values = {}) {
  const env = { ...process.env, ...values };
  if (!("MT5_BRIDGE_URL" in values)) delete env.MT5_BRIDGE_URL;
  return env;
}

async function call(method, requestPath, options = {}) {
  sequence += 1;
  return handleV1({
    method,
    path: requestPath,
    query: options.query || {},
    headers: {
      "x-request-id": `mt5-test-${sequence}`,
      ...(options.headers || {}),
    },
    body: options.body,
    env: options.env || envWith(),
    fetchImpl: options.fetchImpl,
    clientKey: options.clientKey || `mt5-client-${sequence}`,
  });
}

function bridgePayload(overrides = {}) {
  return {
    connected: true,
    account: {
      login: 987654321,
      server: "Exness-Demo",
      currency: "usd",
      balance: 2500.5,
      equity: 2510.75,
      margin: 100,
      freeMargin: 2410.75,
      profit: 10.25,
      password: "super-secret",
      token: "bridge-token",
    },
    positions: [
      {
        ticket: 111,
        symbol: "EURUSD",
        side: "buy",
        volume: 0.1,
        openPrice: 1.1,
        currentPrice: 1.105,
        profit: 5.5,
        comment: "do not expose",
        magic: 7,
      },
      {
        ticket: 222,
        symbol: "XAUUSD",
        type: 1,
        volume: "0.2",
        openPrice: 1900,
        currentPrice: 1895,
        profit: -10,
      },
    ],
    credentials: { password: "super-secret" },
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("public MT5 status reports configuration without leaking the bridge URL", async () => {
  const bare = getMt5Status({});
  assert.equal(bare.configured, false);
  assert.equal(bare.status, "not_connected");
  assert.equal(bare.readOnly, true);
  assert.equal(bare.tradingLocked, true);

  const configured = getMt5Status({ MT5_BRIDGE_URL: "http://127.0.0.1:5100" });
  assert.equal(configured.configured, true);
  assert.equal(configured.status, "configured_unverified");
  assert.equal(configured.reasonCode, "MT5_BRIDGE_CONFIGURED_NOT_VERIFIED");
  assert.ok(!JSON.stringify(configured).includes("127.0.0.1"));

  const response = await call("GET", "/mt5/status", {
    env: envWith({ MT5_BRIDGE_URL: "http://127.0.0.1:5100" }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.configured, true);
  assert.equal(response.body.data.readOnly, true);
  assert.equal(response.body.data.tradingLocked, true);
  assert.ok(!JSON.stringify(response.body).includes("127.0.0.1"));
});

test("non-loopback, credential-bearing and query bridge URLs are blocked before any fetch", async () => {
  const blocked = [
    "https://example.com/mt5",
    "http://169.254.169.254/latest/meta-data",
    "http://user:pass@127.0.0.1:5100",
    "http://127.0.0.1:5100/?token=secret",
    "ftp://127.0.0.1:5100",
    "not a url",
  ];
  for (const value of blocked) {
    const status = getMt5Status({ MT5_BRIDGE_URL: value });
    assert.equal(status.status, "blocked", value);
    assert.equal(status.reasonCode, "MT5_BRIDGE_BLOCKED_URL", value);
    assert.ok(!JSON.stringify(status).includes("example.com"), value);
    assert.ok(!JSON.stringify(status).includes("169.254"), value);
    assert.ok(!JSON.stringify(status).includes("secret"), value);

    let called = false;
    const result = await readMt5Snapshot({
      env: { MT5_BRIDGE_URL: value },
      fetchImpl: async () => {
        called = true;
        return jsonResponse(bridgePayload());
      },
    });
    assert.equal(result.ok, false, value);
    assert.equal(result.error.code, "MT5_BRIDGE_BLOCKED_URL", value);
    assert.equal(called, false, value);
  }
});

test("snapshot sanitizes account and position fields and masks the login", async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url: String(url), init };
    return jsonResponse(bridgePayload());
  };
  const result = await readMt5Snapshot({
    env: { MT5_BRIDGE_URL: "http://127.0.0.1:5100" },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  const snapshot = result.snapshot;
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.tradingLocked, true);
  assert.equal(snapshot.account.login, "****4321");
  assert.equal(snapshot.account.currency, "USD");
  assert.equal(snapshot.account.balance, 2500.5);
  assert.equal(snapshot.positions.length, 2);
  assert.equal(snapshot.positions[0].side, "BUY");
  assert.equal(snapshot.positions[1].side, "SELL");
  assert.deepEqual(Object.keys(snapshot.positions[0]).sort(), [
    "currentPrice",
    "openPrice",
    "profit",
    "side",
    "symbol",
    "volume",
  ]);

  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes("super-secret"));
  assert.ok(!serialized.includes("bridge-token"));
  assert.ok(!serialized.includes("do not expose"));
  assert.ok(!serialized.includes("111"));

  assert.equal(seen.url, "http://127.0.0.1:5100/snapshot");
  assert.equal(seen.init.method, "GET");
  assert.equal(seen.init.redirect, "error");
  assert.equal(seen.init.signal instanceof AbortSignal, true);
});

test("a reachable bridge with no terminal returns no account data", async () => {
  const result = await readMt5Snapshot({
    env: { MT5_BRIDGE_URL: "http://localhost:5100" },
    fetchImpl: async () =>
      jsonResponse({
        connected: false,
        account: { login: 111, balance: 999 },
        positions: [{ symbol: "EURUSD", profit: 50 }],
      }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.connected, false);
  assert.equal(result.snapshot.account, null);
  assert.deepEqual(result.snapshot.positions, []);
  assert.equal(result.snapshot.reasonCode, "MT5_BRIDGE_NOT_CONNECTED");
  assert.equal(result.snapshot.readOnly, true);
  assert.equal(result.snapshot.tradingLocked, true);
});

test("timeouts, unreachable bridges and invalid payloads fail with safe codes", async () => {
  const timeout = await readMt5Snapshot({
    env: { MT5_BRIDGE_URL: "http://127.0.0.1:5100" },
    timeoutMs: 10,
    fetchImpl: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.error.code, "MT5_BRIDGE_TIMEOUT");

  const unreachable = await readMt5Snapshot({
    env: { MT5_BRIDGE_URL: "http://127.0.0.1:5100" },
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5100");
    },
  });
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.error.code, "MT5_BRIDGE_UNREACHABLE");
  assert.ok(!JSON.stringify(unreachable).includes("ECONNREFUSED"));

  for (const response of [
    new Response("not-json", { status: 200 }),
    new Response("x".repeat(600 * 1024), { status: 200 }),
    jsonResponse({ account: {} }),
    jsonResponse({ connected: true }),
    new Response("boom", { status: 500 }),
  ]) {
    const result = await readMt5Snapshot({
      env: { MT5_BRIDGE_URL: "http://127.0.0.1:5100" },
      fetchImpl: async () => response,
    });
    assert.equal(result.ok, false);
    assert.ok(
      ["MT5_BRIDGE_INVALID_RESPONSE", "MT5_BRIDGE_UNREACHABLE"].includes(result.error.code),
      result.error.code,
    );
  }
});

test("snapshot endpoint requires the control token and POST actions are rejected", async () => {
  const env = envWith({ MT5_BRIDGE_URL: "http://127.0.0.1:5100" });

  const denied = await call("GET", "/mt5/snapshot", { env });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "APPROVAL_REQUIRED");

  const bad = await call("GET", "/mt5/snapshot", {
    env,
    headers: { "x-grandmaster-token": "wrong-token-000000000000" },
  });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.error.code, "INVALID_CONTROL_TOKEN");

  let called = false;
  const snapshot = await call("GET", "/mt5/snapshot", {
    env,
    headers: authorized,
    fetchImpl: async () => {
      called = true;
      return jsonResponse(bridgePayload());
    },
  });
  assert.equal(called, true);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.data.snapshot.readOnly, true);
  assert.equal(snapshot.body.data.snapshot.tradingLocked, true);
  assert.equal(snapshot.body.data.snapshot.account.login, "****4321");
  assert.ok(!JSON.stringify(snapshot.body).includes(TOKEN));

  const post = await call("POST", "/mt5/snapshot", { env, headers: authorized, body: {} });
  assert.equal(post.status, 405);
  assert.equal(post.body.error.code, "MT5_READ_ONLY");

  const postStatus = await call("POST", "/mt5/status", { env, headers: authorized, body: {} });
  assert.equal(postStatus.status, 405);
  assert.equal(postStatus.body.error.code, "MT5_READ_ONLY");
});

test("unconfigured or blocked bridges fail closed without a network call", async () => {
  let called = false;
  const unconfigured = await call("GET", "/mt5/snapshot", {
    env: envWith(),
    headers: authorized,
    fetchImpl: async () => {
      called = true;
      return jsonResponse(bridgePayload());
    },
  });
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.body.error.code, "MT5_BRIDGE_NOT_CONFIGURED");
  assert.equal(called, false);

  const blockedStatus = await call("GET", "/mt5/status", {
    env: envWith({ MT5_BRIDGE_URL: "https://example.com" }),
  });
  assert.equal(blockedStatus.status, 200);
  assert.equal(blockedStatus.body.data.status, "blocked");
  assert.ok(!JSON.stringify(blockedStatus.body).includes("example.com"));

  const blockedSnapshot = await call("GET", "/mt5/snapshot", {
    env: envWith({ MT5_BRIDGE_URL: "https://example.com" }),
    headers: authorized,
    fetchImpl: async () => {
      called = true;
      return jsonResponse(bridgePayload());
    },
  });
  assert.equal(blockedSnapshot.status, 503);
  assert.equal(blockedSnapshot.body.error.code, "MT5_BRIDGE_BLOCKED_URL");
  assert.equal(called, false);
});

test("integration registry and security posture reflect MT5 configuration honestly", () => {
  const unset = getIntegrations({}).find((item) => item.id === "mt5_monitor");
  assert.equal(unset.status, "not_connected");
  assert.deepEqual(unset.missingConfiguration, ["MT5_BRIDGE_URL"]);
  assert.equal(unset.detail.readOnly, true);
  assert.equal(unset.detail.tradingLocked, true);

  const configured = getIntegrations({ MT5_BRIDGE_URL: "http://127.0.0.1:5100" }).find(
    (item) => item.id === "mt5_monitor",
  );
  assert.equal(configured.status, "degraded");
  assert.deepEqual(configured.missingConfiguration, []);
  assert.equal(configured.detail.configured, true);
  assert.equal(configured.detail.tradingLocked, true);
  assert.ok(!JSON.stringify(configured).includes("127.0.0.1"));

  const posture = getSecurityPosture({ MT5_BRIDGE_URL: "http://127.0.0.1:5100" });
  const mt5 = posture.lockedActions.find((item) => item.action === "mt5");
  assert.equal(mt5.status, "MONITOR ONLY");
  assert.match(mt5.detail, /read-only bridge is configured/i);
  assert.ok(!JSON.stringify(posture).includes("127.0.0.1"));
});

test("the MT5 page is read-only and never stores the token in browser storage", () => {
  const source = fs.readFileSync(new URL("../src/pages/Mt5Monitor.jsx", import.meta.url), "utf8");
  assert.match(source, /type="password"/);
  assert.match(source, /X-Grandmaster-Token/);
  assert.match(source, /TRADING LOCKED/);
  assert.match(source, /\/mt5\/snapshot/);
  assert.match(source, /\/mt5\/status/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(source, /\/mt5\/(order|trade|close|withdraw|cancel)/i);
  assert.doesNotMatch(source, /(mt5|broker)[^.\n]{0,40}password/i);

  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /id: "mt5"/);
  assert.match(app, /<Mt5Monitor apiBase=\{API_BASE\}/);
});
