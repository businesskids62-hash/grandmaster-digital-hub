// Bounded local load test: 50 requests, concurrency 5.
// The AI provider is mocked in-process, so no paid provider traffic is used.
// Run: npm run test:load

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const REQUESTS = 50;
const CONCURRENCY = 5;
const MOCK_LATENCY_MS = 25;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-load-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "load-test-control-token-123456";
process.env.GRANDMASTER_UI_PASSWORD = "load-test-ui-password-123";
process.env.GRANDMASTER_SESSION_SECRET =
  "load-test-session-secret-0123456789abcdef0123";
process.env.AUTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.AI_RATE_LIMIT_PER_MINUTE = "1000";
process.env.HEALTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:5174";
process.env.AI_MODEL = "load-test-model";
process.env.AI_FALLBACK_MODEL = "load-test-fallback";
process.env.GEMINI_API_KEY = "load-test-key-not-real";
process.env.AI_RESPONSE_CACHE_TTL_MS = "0";
process.env.AI_MAX_CONCURRENCY = "8";
delete process.env.AI_PROVIDERS;
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

let providerCalls = 0;
globalThis.fetch = async () => {
  providerCalls += 1;
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => ({
      candidates: [{ content: { parts: [{ text: "mock reply" }] } }],
    }),
  };
};

const { createApp } = await import("../server/server.js");
const { createSessionToken, SESSION_COOKIE_NAME } = await import(
  "../lib/auth/session.js"
);

const app = createApp();
const server = await new Promise((resolve) => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});
const { port } = server.address();
const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(process.env)}`;
const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY });

function sendChat(index) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message: `load request ${index}` });
    const started = process.hrtime.bigint();
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/chat",
        method: "POST",
        agent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Cookie: cookie,
          "x-request-id": `load-${index}`,
        },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }
          resolve({ status: response.statusCode, elapsedMs, code: parsed?.code || null });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

function percentile(sorted, fraction) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

const startedAt = Date.now();
const results = [];
let nextIndex = 0;

async function worker() {
  while (nextIndex < REQUESTS) {
    const index = nextIndex;
    nextIndex += 1;
    try {
      results.push(await sendChat(index));
    } catch (error) {
      results.push({ status: 0, elapsedMs: 0, code: error?.message || "network" });
    }
  }
}

try {
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const wallMs = Date.now() - startedAt;
  const latencies = results.map((result) => result.elapsedMs).sort((a, b) => a - b);
  const statuses = {};
  for (const result of results) {
    const key = String(result.status);
    statuses[key] = (statuses[key] || 0) + 1;
  }
  const mean = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;

  console.log(
    JSON.stringify(
      {
        requests: REQUESTS,
        concurrency: CONCURRENCY,
        mockProviderLatencyMs: MOCK_LATENCY_MS,
        wallMs,
        requestsPerSecond: Number((REQUESTS / (wallMs / 1000)).toFixed(2)),
        statuses,
        providerCalls,
        latencyMs: {
          min: Number(latencies[0].toFixed(1)),
          mean: Number(mean.toFixed(1)),
          p50: Number(percentile(latencies, 0.5).toFixed(1)),
          p95: Number(percentile(latencies, 0.95).toFixed(1)),
          max: Number(latencies[latencies.length - 1].toFixed(1)),
        },
      },
      null,
      2,
    ),
  );

  const failures = results.filter((result) => result.status !== 200);
  if (failures.length > 0) {
    console.error(`Load test failed: ${failures.length} non-200 responses.`);
    process.exitCode = 1;
  } else if (providerCalls !== REQUESTS) {
    console.error(
      `Load test failed: expected ${REQUESTS} provider calls, saw ${providerCalls}.`,
    );
    process.exitCode = 1;
  }
} finally {
  agent.destroy();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
