import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-reliability-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "reliability-control-token-12345";
process.env.GRANDMASTER_UI_PASSWORD = "reliability-ui-password-123";
process.env.GRANDMASTER_SESSION_SECRET =
  "reliability-session-secret-0123456789abcdef0123";
process.env.AUTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.AI_RATE_LIMIT_PER_MINUTE = "1000";
process.env.HEALTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:5174";
process.env.AI_MODEL = "reliability-model";
process.env.AI_FALLBACK_MODEL = "reliability-fallback";
process.env.GEMINI_API_KEY = "reliability-mock-key-12345";
delete process.env.AI_PROVIDERS;
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

const {
  answerChat,
  buildProviderVerificationStatus,
  executeProviderRotation,
  getVerificationSnapshot,
  isSnapshotFresh,
  LIVE_VERIFY_TTL_MS,
  MAX_ATTEMPTS_PER_PROVIDER,
  resetBreakerState,
  resetModelListCache,
  resetResponseCache,
  resetVerificationSnapshot,
  verifyProvider,
  verifyProviderCached,
} = await import("../lib/aiProviders.js");
const { applyCors } = await import("../lib/cors.js");
const {
  createAiHealthReport,
  createMt5HealthReport,
  createStorageHealthReport,
} = await import("../lib/subsystemHealth.js");
const aiHealthHandler = (await import("../api/health/ai.js")).default;
const storageHealthHandler = (await import("../api/health/storage.js")).default;
const chatHandler = (await import("../api/chat.js")).default;
const { createSessionToken, SESSION_COOKIE_NAME } = await import(
  "../lib/auth/session.js"
);

const KEY = "reliability-mock-key-12345";
const PRODUCTION_ORIGIN = "https://grandmaster-digital-hub.vercel.app";

function okResponse(text = "OK") {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  };
}

function modelsResponse(models) {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => ({ models: models.map((name) => ({ name: `models/${name}` })) }),
  };
}

function failureResponse(status, headers = new Map()) {
  return {
    ok: false,
    status,
    headers,
    json: async () => ({ error: { message: `upstream ${status}` } }),
  };
}

function hangingFetch() {
  return (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
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

function sessionCookie() {
  return `${SESSION_COOKIE_NAME}=${createSessionToken(process.env)}`;
}

after(() => {
  resetVerificationSnapshot();
  resetBreakerState();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("transient 503 is retried with exponential backoff and jitter, then succeeds", async () => {
  resetBreakerState();
  const env = { AI_PROVIDERS: "gemini:transient-model", GEMINI_API_KEY: KEY };
  const sleeps = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls < 3 ? failureResponse(503) : okResponse("Recovered");
  };

  const result = await executeProviderRotation({
    message: "retry test",
    env,
    fetchImpl,
    sleepFn: async (ms) => sleeps.push(ms),
  });

  assert.equal(result.reply, "Recovered");
  assert.equal(calls, 3);
  assert.equal(calls, MAX_ATTEMPTS_PER_PROVIDER);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 400 && sleeps[0] <= 550, `first delay ${sleeps[0]}`);
  assert.ok(sleeps[1] >= 800 && sleeps[1] <= 950, `second delay ${sleeps[1]}`);
  assert.equal(result.attempts[0].status, "retrying");
  assert.equal(result.attempts[1].status, "retrying");
  assert.equal(result.attempts[2].status, "success");
  resetBreakerState();
});

test("the response cache expires after its TTL", async () => {
  resetBreakerState();
  resetResponseCache();
  const env = {
    AI_PROVIDERS: "gemini:cache-expiry-model",
    GEMINI_API_KEY: KEY,
    AI_RESPONSE_CACHE_TTL_MS: "40",
  };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return okResponse(`call ${calls}`);
  };

  try {
    const first = await answerChat({
      clientKey: "expiry-client",
      message: "same question",
      env,
      fetchImpl,
    });
    const hit = await answerChat({
      clientKey: "expiry-client",
      message: "same question",
      env,
      fetchImpl,
    });
    assert.equal(first.cached, false);
    assert.equal(hit.cached, true);
    assert.equal(calls, 1);

    await new Promise((resolve) => setTimeout(resolve, 80));
    const expired = await answerChat({
      clientKey: "expiry-client",
      message: "same question",
      env,
      fetchImpl,
    });
    assert.equal(expired.cached, false);
    assert.equal(expired.reply, "call 2");
    assert.equal(calls, 2);
  } finally {
    resetResponseCache();
    resetBreakerState();
  }
});

test("network errors are retried and bounded", async () => {
  resetBreakerState();
  const env = { AI_PROVIDERS: "gemini:network-model", GEMINI_API_KEY: KEY };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 2) throw new TypeError("fetch failed");
    return okResponse("Network recovered");
  };

  const result = await executeProviderRotation({
    message: "network test",
    env,
    fetchImpl,
    sleepFn: async () => {},
  });
  assert.equal(result.reply, "Network recovered");
  assert.equal(calls, 2);
  assert.equal(result.attempts[0].errorCategory, "provider_transport");
  resetBreakerState();
});

test("400, 401, 403 and 404 are never retried and map to clean codes", async () => {
  const cases = [
    [400, "ALL_PROVIDERS_FAILED", 503],
    [401, "AI_AUTH_FAILED", 502],
    [403, "AI_AUTH_FAILED", 502],
    [404, "AI_MODEL_UNAVAILABLE", 503],
  ];

  for (const [statusCode, expectedCode, expectedStatus] of cases) {
    resetBreakerState();
    const env = { AI_PROVIDERS: "gemini:no-retry-model", GEMINI_API_KEY: KEY };
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return failureResponse(statusCode);
    };

    await assert.rejects(
      async () =>
        executeProviderRotation({
          message: "no retry test",
          env,
          fetchImpl,
          maxRetries: 2,
          sleepFn: async () => {
            throw new Error("sleep must not run for a non-retryable status");
          },
        }),
      (error) => {
        assert.equal(error.code, expectedCode, `HTTP ${statusCode}`);
        assert.equal(error.status, expectedStatus, `HTTP ${statusCode}`);
        assert.equal(error.attempts.length, 1, `HTTP ${statusCode}`);
        return true;
      },
    );
    assert.equal(calls, 1, `HTTP ${statusCode} must be attempted once`);
  }
  resetBreakerState();
});

test("a bounded timeout stops inside the deadline with sanitized evidence", async () => {
  resetBreakerState();
  const env = {
    AI_PROVIDERS: "gemini:timeout-primary,gemini:timeout-fallback",
    GEMINI_API_KEY: KEY,
  };
  const started = Date.now();

  await assert.rejects(
    async () =>
      executeProviderRotation({
        message: "timeout test",
        env,
        fetchImpl: hangingFetch(),
        timeoutMs: 100,
        sleepFn: async () => {},
      }),
    (error) => {
      const elapsed = Date.now() - started;
      assert.equal(error.code, "AI_TIMEOUT");
      assert.equal(error.status, 504);
      assert.equal(error.retryable, true);
      assert.equal(error.fallbackUsed, true);
      assert.ok(elapsed < 3_000, `bounded timeout took ${elapsed}ms`);
      assert.equal(error.attempts.length, MAX_ATTEMPTS_PER_PROVIDER * 2);
      assert.ok(
        error.attempts.every(
          (attempt) => attempt.errorCategory === "provider_timeout",
        ),
      );
      assert.equal(
        error.attempts.at(-1).status,
        "failed",
        "the final attempt must be a failure, not a pending retry",
      );
      assert.deepEqual(
        [...new Set(error.attempts.map((attempt) => attempt.model))].sort(),
        ["timeout-fallback", "timeout-primary"],
      );
      assert.equal(JSON.stringify(error.attempts).includes(KEY), false);
      return true;
    },
  );
  resetBreakerState();
});

test("the fallback model ID is verified against the provider model list", async () => {
  resetVerificationSnapshot();
  resetBreakerState();
  const env = {
    AI_PROVIDERS: "gemini:primary-verified,gemini:fallback-missing",
    GEMINI_API_KEY: KEY,
  };
  const fetchImpl = async (url) =>
    String(url).includes("/models?pageSize")
      ? modelsResponse(["primary-verified"])
      : okResponse("OK");

  try {
    const verification = await verifyProvider(env, { fetchImpl, timeoutMs: 1_000 });
    assert.equal(verification.status, "verified");
    assert.equal(verification.modelList.ok, true);
    assert.equal(verification.modelList.available["primary-verified"], true);
    assert.equal(verification.modelList.available["fallback-missing"], false);

    const status = buildProviderVerificationStatus(env, {
      snapshot: getVerificationSnapshot(),
    });
    assert.equal(status.health, "GREEN");
    assert.equal(status.fallbackModel, "fallback-missing");
    assert.equal(status.fallbackVerified, false);
    assert.equal(status.cached, true);

    resetVerificationSnapshot();
    const bothFetch = async (url) =>
      String(url).includes("/models?pageSize")
        ? modelsResponse(["primary-verified", "fallback-missing"])
        : okResponse("OK");
    const lenient = await verifyProvider(env, { fetchImpl: bothFetch, timeoutMs: 1_000 });
    assert.equal(lenient.modelList.available["fallback-missing"], true);
  } finally {
    resetVerificationSnapshot();
    resetBreakerState();
  }
});

test("subsystem health reports timestamp, latency and stale flags", async () => {
  resetVerificationSnapshot();
  resetBreakerState();
  const env = { AI_PROVIDERS: "gemini:health-model", GEMINI_API_KEY: KEY };
  const fetchImpl = async (url) =>
    String(url).includes("/models?pageSize") ? modelsResponse(["health-model"]) : okResponse();

  await verifyProvider(env, { fetchImpl, timeoutMs: 1_000 });

  const ai = createAiHealthReport({ env });
  assert.equal(ai.subsystem, "ai");
  assert.equal(ai.ok, true);
  assert.equal(ai.status, "GREEN");
  assert.equal(ai.cached, true);
  assert.equal(ai.stale, false);
  assert.equal(typeof ai.latencyMs, "number");
  assert.equal(typeof ai.timestamp, "string");
  assert.equal(Number.isFinite(Date.parse(ai.timestamp)), true);

  const mt5 = await createMt5HealthReport({ env: {} });
  assert.equal(mt5.subsystem, "mt5");
  assert.equal(mt5.ok, false);
  assert.equal(mt5.status, "not_connected");
  assert.equal(mt5.stale, true);
  assert.equal(mt5.readOnly, true);
  assert.equal(mt5.tradingLocked, true);
  assert.equal(typeof mt5.latencyMs, "number");

  const storage = createStorageHealthReport();
  assert.equal(storage.subsystem, "storage");
  assert.equal(storage.ok, true);
  assert.equal(storage.status, "durable");
  assert.equal(storage.stale, false);
  assert.equal(typeof storage.latencyMs, "number");
  for (const store of Object.values(storage.stores)) {
    assert.equal(typeof store.latencyMs, "number");
    assert.equal(store.writable, true);
  }

  resetVerificationSnapshot();
  resetBreakerState();
});

test("Vercel subsystem health requires a session and labels cached data", async () => {
  const denied = fakeRes();
  await storageHealthHandler(
    { method: "GET", headers: { "x-forwarded-for": "203.0.113.40" }, socket: {} },
    denied,
  );
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body.code, "AUTH_REQUIRED");

  const storage = fakeRes();
  await storageHealthHandler(
    {
      method: "GET",
      headers: { "x-forwarded-for": "203.0.113.41", cookie: sessionCookie() },
      socket: {},
    },
    storage,
  );
  assert.equal(storage.statusCode, 200);
  assert.equal(storage.body.subsystem, "storage");
  assert.equal(storage.body.stale, false);
  assert.ok(storage.body.requestId);

  const ai = fakeRes();
  await aiHealthHandler(
    {
      method: "GET",
      headers: { "x-forwarded-for": "203.0.113.42", cookie: sessionCookie() },
      socket: {},
    },
    ai,
  );
  assert.equal(ai.statusCode, 200);
  assert.equal(ai.body.subsystem, "ai");
  assert.equal(ai.body.cached, true);
  assert.equal(typeof ai.body.stale, "boolean");
});

test("chat failures return sanitized correlation fields, never the API key", async () => {
  resetBreakerState();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => failureResponse(503);

  try {
    const res = fakeRes();
    await chatHandler(
      {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.55",
          "x-request-id": "reliability-correlation-1",
          cookie: sessionCookie(),
        },
        body: { message: "failure evidence" },
        socket: {},
      },
      res,
    );

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, "ALL_PROVIDERS_FAILED");
    assert.equal(res.body.requestId, "reliability-correlation-1");
    assert.equal(res.headers["x-request-id"], "reliability-correlation-1");
    assert.equal(res.body.fallbackUsed, true);
    assert.equal(res.body.cached, false);
    assert.equal(typeof res.body.durationMs, "number");
    assert.equal(res.body.attempts.length, MAX_ATTEMPTS_PER_PROVIDER * 2);
    assert.deepEqual(
      [...new Set(res.body.attempts.map((attempt) => attempt.model))].sort(),
      ["reliability-fallback", "reliability-model"],
    );
    assert.equal(JSON.stringify(res.body).includes(KEY), false);
  } finally {
    globalThis.fetch = originalFetch;
    resetBreakerState();
  }
});

test("retries cannot outlive the total deadline", async () => {
  resetBreakerState();
  const env = { AI_PROVIDERS: "gemini:deadline-model", GEMINI_API_KEY: KEY };
  const sleeps = [];
  let calls = 0;
  const started = Date.now();

  await assert.rejects(
    async () =>
      executeProviderRotation({
        message: "deadline test",
        env,
        fetchImpl: async () => {
          calls += 1;
          return failureResponse(503);
        },
        maxRetries: 2,
        totalBudgetMs: 250,
        sleepFn: async (ms) => sleeps.push(ms),
      }),
    (error) => {
      assert.equal(calls, 1, "a retry must not start when its backoff passes the deadline");
      assert.deepEqual(sleeps, [], "no backoff may run past the deadline");
      assert.equal(error.code, "ALL_PROVIDERS_FAILED");
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0].retryable, true);
      assert.ok(Date.now() - started < 250, "failure inside the total deadline");
      return true;
    },
  );
  resetBreakerState();
});

test("slow primary and fallback are bounded by one total deadline", async () => {
  resetBreakerState();
  const env = {
    AI_PROVIDERS: "gemini:slow-primary,gemini:slow-fallback",
    GEMINI_API_KEY: KEY,
  };
  const started = Date.now();

  await assert.rejects(
    async () =>
      executeProviderRotation({
        message: "slow both providers",
        env,
        fetchImpl: hangingFetch(),
        timeoutMs: 150,
        totalBudgetMs: 800,
        maxRetries: 0,
        sleepFn: async () => {},
      }),
    (error) => {
      const elapsed = Date.now() - started;
      assert.equal(error.code, "AI_TIMEOUT");
      assert.equal(error.status, 504);
      assert.equal(error.fallbackUsed, true);
      assert.deepEqual(
        error.attempts.map((attempt) => attempt.model),
        ["slow-primary", "slow-fallback"],
      );
      assert.ok(elapsed < 800, `both providers must fit the deadline (${elapsed}ms)`);
      return true;
    },
  );
  resetBreakerState();
});

test("cancellation during retry backoff stops the rotation immediately", async () => {
  resetBreakerState();
  const env = { AI_PROVIDERS: "gemini:cancel-model", GEMINI_API_KEY: KEY };
  const controller = new AbortController();
  let calls = 0;
  const started = Date.now();

  const promise = executeProviderRotation({
    message: "cancel during backoff",
    env,
    fetchImpl: async () => {
      calls += 1;
      return failureResponse(503);
    },
    maxRetries: 2,
    signal: controller.signal,
    sleepFn: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  setTimeout(() => controller.abort(), 40);

  await assert.rejects(promise, (error) => {
    assert.equal(error.code, "AI_REQUEST_CANCELLED");
    assert.equal(error.status, 499);
    assert.equal(calls, 1, "no provider call after cancellation");
    assert.ok(Date.now() - started < 350, "returned during the backoff window");
    assert.equal(error.attempts.at(-1).status, "failed");
    assert.equal(error.attempts.at(-1).errorCategory, "request_cancelled");
    return true;
  });
  resetBreakerState();
});

test("verification status cache is fresh inside its TTL and stale afterwards", () => {
  resetVerificationSnapshot();
  const env = {
    AI_PROVIDERS: "gemini:cache-model,gemini:cache-fallback",
    GEMINI_API_KEY: KEY,
  };
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const snapshot = {
    status: "verified",
    state: "live",
    checkedAt: new Date(now - 30_000).toISOString(),
    provider: "gemini",
    model: "cache-model",
    latencyMs: 123,
    modelList: {
      ok: true,
      available: { "cache-model": true, "cache-fallback": true },
    },
  };

  assert.equal(isSnapshotFresh(snapshot, LIVE_VERIFY_TTL_MS, now), true);
  assert.equal(
    isSnapshotFresh(snapshot, LIVE_VERIFY_TTL_MS, now + 30_002),
    false,
    "age beyond the TTL is stale",
  );

  const fresh = buildProviderVerificationStatus(env, { snapshot, source: "cache", now });
  assert.equal(fresh.status, "verified");
  assert.equal(fresh.health, "GREEN");
  assert.equal(fresh.cached, true);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.cacheAgeMs, 30_000);
  assert.equal(fresh.fallbackModel, "cache-fallback");
  assert.equal(fresh.fallbackVerified, true);

  const stale = buildProviderVerificationStatus(env, {
    snapshot,
    source: "cache",
    now: now + LIVE_VERIFY_TTL_MS + 1,
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.health, "STALE");
  assert.equal(stale.verified, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.inFlight, false);
});

test("concurrent status requests share a single live verification", async () => {
  resetVerificationSnapshot();
  resetBreakerState();
  const env = { AI_PROVIDERS: "gemini:shared-model", GEMINI_API_KEY: KEY };
  let generateCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("/models?pageSize")) return modelsResponse(["shared-model"]);
    generateCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return okResponse("OK");
  };

  try {
    const results = await Promise.all([
      verifyProviderCached(env, { fetchImpl }),
      verifyProviderCached(env, { fetchImpl }),
      verifyProviderCached(env, { fetchImpl }),
    ]);
    assert.equal(generateCalls, 1, "concurrent callers share one inference");
    assert.ok(results.every((result) => result === results[0]));
    assert.equal(results[0].status, "verified");

    const cached = await verifyProviderCached(env, { fetchImpl });
    assert.equal(cached.status, "verified");
    assert.equal(generateCalls, 1, "a fresh cache must not re-verify");
  } finally {
    resetVerificationSnapshot();
    resetBreakerState();
  }
});

test("CORS preflight accepts exactly the production origin", () => {
  const env = { CORS_ALLOWED_ORIGINS: PRODUCTION_ORIGIN };

  const preflight = fakeRes();
  const answered = applyCors(
    { method: "OPTIONS", headers: { origin: PRODUCTION_ORIGIN } },
    preflight,
    env,
  );
  assert.equal(answered, true);
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], PRODUCTION_ORIGIN);
  assert.equal(preflight.headers["access-control-allow-credentials"], "true");
  assert.equal(preflight.headers.vary, "Origin");
  assert.ok(preflight.headers["access-control-allow-methods"].includes("POST"));

  const spoofed = fakeRes();
  applyCors(
    {
      method: "OPTIONS",
      headers: { origin: "https://grandmaster-digital-hub.vercel.app.evil.example" },
    },
    spoofed,
    env,
  );
  assert.equal(spoofed.statusCode, 403);

  const unset = fakeRes();
  applyCors(
    { method: "OPTIONS", headers: { origin: PRODUCTION_ORIGIN } },
    unset,
    { NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "" },
  );
  assert.equal(unset.statusCode, 403, "production without an allow-list fails closed");
});

test("Vercel chat preflight answers before auth when the production origin is allowed", async () => {
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = PRODUCTION_ORIGIN;
  try {
    const res = fakeRes();
    await chatHandler(
      {
        method: "OPTIONS",
        headers: { origin: PRODUCTION_ORIGIN, "x-forwarded-for": "203.0.113.70" },
        socket: {},
      },
      res,
    );
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["access-control-allow-origin"], PRODUCTION_ORIGIN);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.body, null, "preflight must not reach the chat handler");
  } finally {
    process.env.CORS_ALLOWED_ORIGINS = previous;
  }
});
