// tests/aiProviders.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  executeProviderRotation,
  getProviderStatusList,
  resetBreakerState,
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
      });
    },
    (err) => {
      assert.equal(err.status, 503);
      assert.ok(Array.isArray(err.attempts));
      assert.equal(err.attempts.length, 2);
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
