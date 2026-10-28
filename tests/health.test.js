import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-health-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "health-control-token-1234567890";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.HEALTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.ALLOWED_ORIGINS = "http://localhost:5173";
process.env.AI_PROVIDERS = "gemini:test-model";
process.env.GEMINI_API_KEY = "";
process.env.AI_API_KEY = "";
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

const {
  checkHealthRateLimit,
  createHealthReport,
  healthRateLimitHeaders,
  resetHealthRateLimits,
} = await import("../lib/healthStatus.js");
const { resetVerificationSnapshot, verifyProvider } = await import(
  "../lib/aiProviders.js"
);
const healthHandler = (await import("../api/health.js")).default;

const fakeProviderFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: "OK" }] } }],
  }),
});

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
  resetVerificationSnapshot();
  resetHealthRateLimits();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("GREEN requires passing core checks and a current live provider verification", async () => {
  resetVerificationSnapshot();
  const env = { ...process.env, GEMINI_API_KEY: "unit-test-key" };
  const verified = await verifyProvider(env, { fetchImpl: fakeProviderFetch });
  assert.equal(verified.status, "verified");

  const report = createHealthReport({ env, uptime: 12 });
  assert.equal(report.statusCode, 200);
  assert.equal(report.body.status, "GREEN");
  assert.equal(report.body.ok, true);
  assert.equal(report.body.service, "GREEN");
  assert.equal(report.body.degraded, false);
  assert.deepEqual(report.body.reasonCodes, []);
  assert.equal(report.body.checks.controlAuthority.status, "pass");
  assert.equal(report.body.checks.aiProvider.liveVerified, true);
  assert.equal(report.body.checks.aiProvider.verificationState, "live_verified");
  assert.equal(report.body.providerStatus, "GREEN");
  assert.equal(report.body.storageStatus, "GREEN");
  assert.equal(report.body.verification.liveProviderCall, false);
  assert.equal(report.body.verification.source, "cached process snapshot");
  resetVerificationSnapshot();
});

test("DEGRADED when core works but the AI provider is not configured", () => {
  resetVerificationSnapshot();
  const report = createHealthReport({
    env: { ...process.env, GEMINI_API_KEY: "", AI_API_KEY: "" },
  });

  assert.equal(report.statusCode, 200);
  assert.equal(report.body.status, "DEGRADED");
  assert.equal(report.body.ok, true);
  assert.equal(report.body.service, "GREEN");
  assert.equal(report.body.degraded, true);
  assert.ok(report.body.reasonCodes.includes("AI_PROVIDER_NOT_CONFIGURED"));
  assert.equal(report.body.checks.aiProvider.configured, false);
  assert.equal(report.body.checks.aiProvider.liveVerified, false);
  assert.equal(report.body.checks.aiProvider.verificationState, "not_configured");
  assert.equal(report.body.providerStatus, "NOT CONNECTED");
  assert.equal(report.body.aiConfigured, false);
});

test("DEGRADED when a provider is configured but not live verified", () => {
  resetVerificationSnapshot();
  const report = createHealthReport({
    env: { ...process.env, GEMINI_API_KEY: "unit-test-key" },
  });

  assert.equal(report.statusCode, 200);
  assert.equal(report.body.status, "DEGRADED");
  assert.ok(report.body.reasonCodes.includes("AI_PROVIDER_NOT_LIVE_VERIFIED"));
  assert.equal(report.body.checks.aiProvider.configured, true);
  assert.equal(report.body.checks.aiProvider.liveVerified, false);
  assert.equal(report.body.checks.aiProvider.verificationState, "configured_unverified");
  assert.equal(report.body.providerStatus, "CAPABILITY NOT VERIFIED");
});

test("ERROR when the control authority is not configured", () => {
  const report = createHealthReport({
    env: { ...process.env, GRANDMASTER_CONTROL_TOKEN: "" },
  });

  assert.equal(report.statusCode, 503);
  assert.equal(report.body.status, "ERROR");
  assert.equal(report.body.ok, false);
  assert.equal(report.body.service, "ERROR");
  assert.equal(report.body.checks.controlAuthority.status, "fail");
  assert.ok(report.body.reasonCodes.includes("CONTROL_AUTHORITY_NOT_CONFIGURED"));
});

test("ERROR when a core store cannot be inspected", () => {
  const cases = [
    ["taskStore", "TASK_STORAGE_UNAVAILABLE"],
    ["memoryStore", "MEMORY_STORAGE_UNAVAILABLE"],
    ["auditStore", "AUDIT_STORAGE_UNAVAILABLE"],
  ];
  const broken = {
    status() {
      throw new Error(`storage unavailable at ${path.join(dataDir, "secret.json")}`);
    },
  };

  for (const [option, expectedCode] of cases) {
    const report = createHealthReport({
      env: { ...process.env },
      [option]: broken,
    });
    assert.equal(report.statusCode, 503, `${option} must make health ERROR`);
    assert.equal(report.body.status, "ERROR");
    assert.ok(report.body.reasonCodes.includes(expectedCode));
    assert.equal(
      JSON.stringify(report.body).includes("secret.json"),
      false,
      "store error details must not leak",
    );
  }
});

test("DEGRADED when storage is not durable", () => {
  const memoryOnly = {
    status: () => ({
      mode: "memory",
      durable: false,
      ephemeral: false,
      writable: false,
    }),
  };
  const memoryReport = createHealthReport({
    env: { ...process.env },
    memoryStore: memoryOnly,
  });
  assert.equal(memoryReport.statusCode, 200);
  assert.equal(memoryReport.body.status, "DEGRADED");
  assert.ok(memoryReport.body.reasonCodes.includes("STORAGE_MEMORY_ONLY"));

  const ephemeral = {
    status: () => ({
      mode: "ephemeral",
      durable: false,
      ephemeral: true,
      writable: true,
    }),
  };
  const ephemeralReport = createHealthReport({
    env: { ...process.env },
    taskStore: ephemeral,
  });
  assert.equal(ephemeralReport.statusCode, 200);
  assert.equal(ephemeralReport.body.status, "DEGRADED");
  assert.ok(ephemeralReport.body.reasonCodes.includes("STORAGE_EPHEMERAL"));
  assert.equal(ephemeralReport.body.storageStatus, "CAPABILITY NOT VERIFIED");
});

test("health output never contains tokens, API keys or filesystem paths", () => {
  const token = "health-redaction-token-1234567890";
  const apiKey = "AIzaSyHEALTHREDACTION1234567890123456";
  const report = createHealthReport({
    env: {
      ...process.env,
      GRANDMASTER_CONTROL_TOKEN: token,
      GEMINI_API_KEY: apiKey,
    },
  });
  const serialized = JSON.stringify(report.body);

  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(apiKey), false);
  assert.equal(serialized.includes(dataDir), false);
  assert.equal(Object.prototype.hasOwnProperty.call(report.body.storage, "path"), false);
  assert.equal(serialized.includes('"path"'), false);
  assert.equal(report.body.status, "DEGRADED");
});

test("health never performs a live provider verification call", async () => {
  resetVerificationSnapshot();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network must not be used by health");
  };

  try {
    const report = createHealthReport({
      env: { ...process.env, GEMINI_API_KEY: "unit-test-key" },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, 0);
    assert.equal(report.body.checks.aiProvider.liveVerified, false);
    assert.equal(report.body.verification.liveProviderCall, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("health rate limiting is per client, bounded and expires", () => {
  resetHealthRateLimits();
  const env = { HEALTH_RATE_LIMIT_PER_MINUTE: "2" };
  const now = 1_000_000;

  assert.equal(checkHealthRateLimit("client-a", env, now).allowed, true);
  const second = checkHealthRateLimit("client-a", env, now + 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);

  const blocked = checkHealthRateLimit("client-a", env, now + 2);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 60);
  assert.equal(healthRateLimitHeaders(blocked)["Retry-After"], "60");

  assert.equal(checkHealthRateLimit("client-b", env, now + 3).allowed, true);
  assert.equal(
    checkHealthRateLimit("client-a", env, now + 60_001).allowed,
    true,
    "window must expire",
  );
  resetHealthRateLimits();
});

test("Vercel health handler is public, truthfully labelled and rate limited", async () => {
  resetHealthRateLimits();
  const req = {
    method: "GET",
    headers: { "x-forwarded-for": "198.51.100.77" },
    socket: {},
  };
  const res = fakeRes();
  await healthHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "DEGRADED");
  assert.equal(res.body.ok, true);
  assert.ok(res.headers["x-request-id"]);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["x-ratelimit-limit"], "1000");

  const postRes = fakeRes();
  await healthHandler({ ...req, method: "POST" }, postRes);
  assert.equal(postRes.statusCode, 405);

  resetHealthRateLimits();
  process.env.HEALTH_RATE_LIMIT_PER_MINUTE = "1";
  try {
    const first = fakeRes();
    await healthHandler(
      {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.88" },
        socket: {},
      },
      first,
    );
    assert.equal(first.statusCode, 200);

    const blocked = fakeRes();
    await healthHandler(
      {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.88" },
        socket: {},
      },
      blocked,
    );
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.body.code, "HEALTH_RATE_LIMITED");
    assert.equal(blocked.headers["retry-after"], "60");
  } finally {
    process.env.HEALTH_RATE_LIMIT_PER_MINUTE = "1000";
    resetHealthRateLimits();
  }
});
