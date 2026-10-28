// tests/aiProviders.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  answerChat,
  executeProviderRotation,
  getProviderStatusList,
  isVerificationCurrent,
  parseProviders,
  providerHealthLabel,
  resetBreakerState,
  resetLiveVerificationCache,
  refreshProviderVerification,
  resetResponseCache,
  resetVerificationSnapshot,
  verifyProvider,
  verifyProviderCached,
  VERIFICATION_TTL_MS,
} from "../lib/aiProviders.js";

const fakeEnv = {
  AI_PROVIDERS: "gemini:gemini-3.8-flash,gemini:gemini-2.5-pro",
  GEMINI_API_KEY: "mock-secret-key-12345",
};

test("1. Fallback works when primary provider returns 429", async () => {
  resetBreakerState();

  const mockFetch = async (url) => {
    if (url.includes("gemini-3.8-flash")) {
      return {
        ok: false,
        status: 429,
        headers: new Map([["retry-after", "30"]]),
        json: async () => ({ error: { message: "Rate limit exceeded" } }),
      };
    }
    // gemini-2.5-pro succeeds
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Pro model response" }] } }],
      }),
    };
  };

  const result = await executeProviderRotation({
    message: "Hello",
    env: fakeEnv,
    fetchImpl: mockFetch,
  });

  assert.equal(result.reply, "Pro model response");
  assert.equal(result.model, "gemini-2.5-pro");
  assert.ok(result.attempts.some((a) => a.provider === "gemini:gemini-3.8-flash" && a.statusCode === 429));
  assert.ok(result.attempts.some((a) => a.provider === "gemini:gemini-2.5-pro" && a.status === "success"));

  // Check that flash is now in cooling state
  const statuses = getProviderStatusList(fakeEnv);
  const flashStatus = statuses.find((s) => s.id === "gemini:gemini-3.8-flash");
  assert.equal(flashStatus.state, "cooling");
  assert.ok(flashStatus.coolingUntil !== null);
});

test("2. Fallback works when primary provider times out", async () => {
  resetBreakerState();

  const mockFetch = async (url) => {
    if (url.includes("gemini-3.8-flash")) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Fallback after timeout" }] } }],
      }),
    };
  };

  const result = await executeProviderRotation({
    message: "Hello timeout",
    env: fakeEnv,
    fetchImpl: mockFetch,
  });

  assert.equal(result.reply, "Fallback after timeout");
  assert.equal(result.model, "gemini-2.5-pro");
});

test("3. Returns clean 503 when all providers fail", async () => {
  resetBreakerState();

  const mockFetch = async () => {
    return {
      ok: false,
      status: 503,
      headers: new Map(),
      json: async () => ({ error: { message: "Service Unavailable" } }),
    };
  };

  await assert.rejects(
    async () => {
      await executeProviderRotation({
        message: "Hello all fail",
        env: fakeEnv,
        fetchImpl: mockFetch,
        sleepFn: async () => {},
      });
    },
    (err) => {
      assert.equal(err.status, 503);
      assert.equal(err.code, "ALL_PROVIDERS_FAILED");
      assert.ok(Array.isArray(err.attempts));
      // Two providers x (initial attempt + 2 bounded retries).
      assert.equal(err.attempts.length, 6);
      assert.ok(err.attempts.every((attempt) => attempt.statusCode === 503));
      assert.equal(err.fallbackUsed, true);
      return true;
    }
  );
});

test("4. Cooldown skips cooling provider and attempts next available provider", async () => {
  resetBreakerState();

  // First call: primary 429, fallback succeeds
  const mockFetchFirst = async (url) => {
    if (url.includes("gemini-3.8-flash")) {
      return {
        ok: false,
        status: 429,
        headers: new Map([["retry-after", "60"]]),
        json: async () => ({ error: { message: "Too Many Requests" } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Success Pro" }] } }],
      }),
    };
  };

  await executeProviderRotation({
    message: "Call 1",
    env: fakeEnv,
    fetchImpl: mockFetchFirst,
  });

  // Second call: verify flash is skipped without calling fetch for it
  let flashCalled = false;
  const mockFetchSecond = async (url) => {
    if (url.includes("gemini-3.8-flash")) {
      flashCalled = true;
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Success Pro Call 2" }] } }],
      }),
    };
  };

  const result2 = await executeProviderRotation({
    message: "Call 2",
    env: fakeEnv,
    fetchImpl: mockFetchSecond,
  });

  assert.equal(flashCalled, false, "Cooling provider must be skipped immediately");
  assert.equal(result2.reply, "Success Pro Call 2");
  const skipAttempt = result2.attempts.find((a) => a.provider === "gemini:gemini-3.8-flash");
  assert.equal(skipAttempt.status, "cooling_skipped");
});

test("5. verification evidence only marks the verified provider as GREEN", async () => {
  resetBreakerState();
  resetVerificationSnapshot();

  const env = {
    AI_PROVIDERS: "gemini:primary-model,gemini:secondary-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
  };
  const mockFetch = async (url) => {
    if (url.includes("primary-model")) {
      return {
        ok: false,
        status: 500,
        headers: new Map(),
        json: async () => ({ error: { message: "Primary unavailable" } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "OK" }] } }],
      }),
    };
  };

  try {
    const result = await verifyProvider(env, {
      fetchImpl: mockFetch,
      timeoutMs: 1_000,
    });
    assert.equal(result.status, "verified");
    assert.equal(result.provider, "gemini");
    assert.equal(result.model, "secondary-model");

    const statuses = getProviderStatusList(env);
    const primary = statuses.find((item) => item.model === "primary-model");
    const secondary = statuses.find((item) => item.model === "secondary-model");
    assert.equal(providerHealthLabel(primary), "CAPABILITY NOT VERIFIED");
    assert.equal(providerHealthLabel(secondary), "GREEN");
  } finally {
    resetBreakerState();
    resetVerificationSnapshot();
  }
});

test("6. failed verification never produces GREEN", async () => {
  resetBreakerState();
  resetVerificationSnapshot();

  const env = {
    AI_PROVIDERS: "gemini:primary-model,gemini:secondary-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
  };
  const failingFetch = async () => ({
    ok: false,
    status: 503,
    headers: new Map(),
    json: async () => ({ error: { message: "Unavailable" } }),
  });

  try {
    const result = await verifyProvider(env, {
      fetchImpl: failingFetch,
      timeoutMs: 1_000,
    });
    assert.equal(result.status, "failed");
    for (const provider of getProviderStatusList(env)) {
      assert.equal(providerHealthLabel(provider), "CAPABILITY NOT VERIFIED");
    }
  } finally {
    resetBreakerState();
    resetVerificationSnapshot();
  }
});

test("7. missing, stale or mismatched evidence never produces GREEN", () => {
  const provider = { configured: true, provider: "gemini", model: "model-a" };
  const valid = {
    status: "verified",
    provider: "gemini",
    model: "model-a",
    checkedAt: new Date().toISOString(),
  };

  assert.equal(providerHealthLabel(provider, null), "CAPABILITY NOT VERIFIED");
  assert.equal(
    providerHealthLabel(provider, { status: "verified" }),
    "CAPABILITY NOT VERIFIED",
  );
  assert.equal(
    providerHealthLabel(provider, { ...valid, provider: "openai" }),
    "CAPABILITY NOT VERIFIED",
  );
  assert.equal(
    providerHealthLabel(provider, { ...valid, model: "model-b" }),
    "CAPABILITY NOT VERIFIED",
  );
  assert.equal(
    providerHealthLabel(provider, {
      ...valid,
      checkedAt: new Date(Date.now() - VERIFICATION_TTL_MS - 1_000).toISOString(),
    }),
    "CAPABILITY NOT VERIFIED",
  );
  assert.equal(providerHealthLabel({ ...provider, configured: false }, valid), "NOT CONNECTED");
  assert.equal(providerHealthLabel(provider, valid), "GREEN");

  assert.equal(isVerificationCurrent(null), false);
  assert.equal(isVerificationCurrent({ status: "verified" }), false);
  assert.equal(
    isVerificationCurrent({
      ...valid,
      checkedAt: new Date(Date.now() - VERIFICATION_TTL_MS - 1_000).toISOString(),
    }),
    false,
  );
  assert.equal(isVerificationCurrent(valid), true);
});

test("9. 429 with a short Retry-After retries the same provider and succeeds", async () => {
  resetBreakerState();
  const env = {
    AI_PROVIDERS: "gemini:retry-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
  };
  let calls = 0;
  const sleeps = [];
  const mockFetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: new Map([["retry-after", "1"]]),
        json: async () => ({ error: { message: "Rate limited" } }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Recovered" }] } }],
      }),
    };
  };

  const result = await executeProviderRotation({
    message: "Retry please",
    env,
    fetchImpl: mockFetch,
    sleepFn: async (ms) => sleeps.push(ms),
  });

  assert.equal(result.reply, "Recovered");
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(result.attempts[0].status, "retrying");
  assert.equal(result.attempts[0].retryAfter, 1);
  assert.equal(result.attempts[1].status, "success");
});

test("10. exhausted 429 retries return AI_QUOTA_EXCEEDED and respect Retry-After", async () => {
  resetBreakerState();
  const env = {
    AI_PROVIDERS: "gemini:quota-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
  };
  let calls = 0;
  const mockFetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 429,
      headers: new Map([["retry-after", "2"]]),
      json: async () => ({ error: { message: "Quota exceeded" } }),
    };
  };

  await assert.rejects(
    async () =>
      executeProviderRotation({
        message: "Quota test",
        env,
        fetchImpl: mockFetch,
        maxRetries: 2,
        sleepFn: async () => {},
      }),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.code, "AI_QUOTA_EXCEEDED");
      assert.equal(error.retryAfter, 2);
      assert.equal(error.retryable, true);
      assert.equal(error.attempts.length, 3, "initial attempt + 2 retries");
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.equal(getProviderStatusList(env)[0].state, "cooling");
  resetBreakerState();
});

test("11. AI_MODEL / AI_FALLBACK_MODEL take precedence over the legacy chain", () => {
  assert.deepEqual(
    parseProviders({
      AI_MODEL: "gemini-3.5-flash-lite",
      AI_FALLBACK_MODEL: "gemini-3.8-flash",
      AI_PROVIDERS: "gemini:legacy-model",
      GEMINI_MODEL: "gemini-old",
    }),
    ["gemini:gemini-3.5-flash-lite", "gemini:gemini-3.8-flash"],
  );
  assert.deepEqual(
    parseProviders({ AI_PROVIDERS: "gemini:chain-model" }),
    ["gemini:chain-model"],
  );
  assert.deepEqual(
    parseProviders({ GEMINI_MODEL: "gemini-legacy" }),
    ["gemini:gemini-legacy"],
  );
});

test("12. answerChat caches successful replies per client for the configured TTL", async () => {
  resetBreakerState();
  resetResponseCache();
  const env = {
    AI_PROVIDERS: "gemini:cache-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
    AI_RESPONSE_CACHE_TTL_MS: "60000",
  };
  let calls = 0;
  const mockFetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Cached reply" }] } }],
      }),
    };
  };

  const first = await answerChat({
    clientKey: "client-a",
    message: "Same question",
    env,
    fetchImpl: mockFetch,
  });
  const second = await answerChat({
    clientKey: "client-a",
    message: "Same question",
    env,
    fetchImpl: mockFetch,
  });
  const other = await answerChat({
    clientKey: "client-b",
    message: "Same question",
    env,
    fetchImpl: mockFetch,
  });

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.reply, "Cached reply");
  assert.equal(other.cached, false);
  assert.equal(calls, 2, "one call per client, cache hit must not call the provider");
  resetResponseCache();
});

test("13. verifyProviderCached makes at most one provider call per TTL", async () => {
  resetBreakerState();
  resetVerificationSnapshot();
  resetLiveVerificationCache();
  const env = {
    AI_PROVIDERS: "gemini:cached-verify-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
  };
  let calls = 0;
  const mockFetch = async (url) => {
    if (String(url).includes("/models?pageSize")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ models: [{ name: "models/cached-verify-model" }] }),
      };
    }
    calls += 1;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "OK" }] } }],
      }),
    };
  };

  try {
    const first = await verifyProviderCached(env, { fetchImpl: mockFetch });
    const second = await verifyProviderCached(env, { fetchImpl: mockFetch });
    assert.equal(first.status, "verified");
    assert.equal(second.status, "verified");
    assert.equal(calls, 1, "cached verification must not call the provider again");

    await verifyProviderCached(env, { fetchImpl: mockFetch, force: true });
    assert.equal(calls, 2);
  } finally {
    resetVerificationSnapshot();
    resetLiveVerificationCache();
  }
});

test("14. status is cache-first, force performs exactly one live verification", async () => {
  resetBreakerState();
  resetVerificationSnapshot();
  resetLiveVerificationCache();
  const env = {
    AI_PROVIDERS: "gemini:status-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
  };
  let calls = 0;
  const mockFetch = async (url) => {
    if (String(url).includes("/models?pageSize")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ models: [{ name: "models/status-model" }] }),
      };
    }
    calls += 1;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "OK" }] } }],
      }),
    };
  };

  try {
    const initial = await refreshProviderVerification(env, { fetchImpl: mockFetch });
    assert.equal(initial.status, "verifying");
    assert.equal(initial.health, "CHECKING");
    assert.equal(initial.source, "background");

    await verifyProviderCached(env, { fetchImpl: mockFetch });
    const cached = await refreshProviderVerification(env, { fetchImpl: mockFetch });
    assert.equal(cached.status, "verified");
    assert.equal(cached.health, "GREEN");
    assert.equal(cached.source, "cache");
    assert.ok(cached.checkedAt);
    assert.equal(calls, 1, "cache-first status must not call the provider");

    const forced = await refreshProviderVerification(env, {
      fetchImpl: mockFetch,
      force: true,
    });
    assert.equal(forced.status, "verified");
    assert.equal(forced.source, "live");
    assert.equal(calls, 2, "force must make exactly one live call");
  } finally {
    resetVerificationSnapshot();
    resetLiveVerificationCache();
    resetBreakerState();
  }
});

test("15. 401 is not retried and is reported as an auth failure", async () => {
  resetBreakerState();
  const env = {
    AI_PROVIDERS: "gemini:auth-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
  };
  let calls = 0;
  const mockFetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 401,
      headers: new Map(),
      json: async () => ({ error: { message: "API key not valid" } }),
    };
  };

  await assert.rejects(
    async () =>
      executeProviderRotation({
        message: "Auth test",
        env,
        fetchImpl: mockFetch,
        maxRetries: 3,
        sleepFn: async () => {},
      }),
    (error) => {
      assert.equal(error.code, "AI_AUTH_FAILED");
      assert.equal(error.status, 502);
      assert.equal(error.attempts.length, 1);
      assert.equal(error.attempts[0].errorCategory, "provider_auth");
      return true;
    },
  );
  assert.equal(calls, 1, "401 must never be retried");
  resetBreakerState();
});

test("16. an external cancel aborts the provider call with AI_REQUEST_CANCELLED", async () => {
  resetBreakerState();
  const env = {
    AI_PROVIDERS: "gemini:cancel-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
  };
  const controller = new AbortController();
  const mockFetch = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    async () =>
      executeProviderRotation({
        message: "Cancel test",
        env,
        fetchImpl: mockFetch,
        timeoutMs: 5_000,
        signal: controller.signal,
      }),
    (error) => {
      assert.equal(error.status, 499);
      assert.equal(error.code, "AI_REQUEST_CANCELLED");
      return true;
    },
  );
  resetBreakerState();
});

test("17. concurrent provider calls are bounded", async () => {
  resetBreakerState();
  const env = {
    AI_PROVIDERS: "gemini:concurrency-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
    AI_MAX_CONCURRENCY: "1",
  };
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const mockFetch = async () => {
    await gate;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "OK" }] } }],
      }),
    };
  };

  const first = executeProviderRotation({
    message: "First",
    env,
    fetchImpl: mockFetch,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  await assert.rejects(
    async () =>
      executeProviderRotation({
        message: "Second",
        env,
        fetchImpl: mockFetch,
      }),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, "AI_BUSY");
      assert.equal(error.retryable, true);
      return true;
    },
  );

  release();
  const result = await first;
  assert.equal(result.reply, "OK");
  resetBreakerState();
});

test("8. verified primary evidence does not mark a secondary provider GREEN", async () => {
  resetBreakerState();
  resetVerificationSnapshot();

  const env = {
    AI_PROVIDERS: "gemini:primary-model,gemini:secondary-model",
    GEMINI_API_KEY: "mock-secret-key-12345",
  };
  const succeedingFetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => ({
      candidates: [{ content: { parts: [{ text: "OK" }] } }],
    }),
  });

  try {
    const result = await verifyProvider(env, {
      fetchImpl: succeedingFetch,
      timeoutMs: 1_000,
    });
    assert.equal(result.status, "verified");
    assert.equal(result.model, "primary-model");

    const statuses = getProviderStatusList(env);
    const primary = statuses.find((item) => item.model === "primary-model");
    const secondary = statuses.find((item) => item.model === "secondary-model");
    assert.equal(providerHealthLabel(primary), "GREEN");
    assert.equal(providerHealthLabel(secondary), "CAPABILITY NOT VERIFIED");
  } finally {
    resetBreakerState();
    resetVerificationSnapshot();
  }
});
