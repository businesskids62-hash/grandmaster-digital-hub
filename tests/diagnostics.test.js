import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-diagnostics-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "diag-control-token-1234567890";
process.env.GRANDMASTER_UI_PASSWORD = "diag-ui-password-123";
process.env.GRANDMASTER_SESSION_SECRET =
  "diag-session-secret-0123456789abcdef0123456789";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.HEALTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.AI_RATE_LIMIT_PER_MINUTE = "1000";
process.env.CORS_ALLOWED_ORIGINS = "http://localhost:5174";
process.env.AI_PROVIDERS = "gemini:test-model";
process.env.GEMINI_API_KEY = "";
process.env.AI_API_KEY = "";
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODEL;

const {
  MAX_LOG_ENTRIES,
  getActiveErrors,
  getLogBufferInfo,
  getRecentLogs,
  maskSecrets,
  recordLog,
  resetLogStore,
} = await import("../lib/diagnostics/logStore.js");
const { logEvent } = await import("../lib/logger.js");
const { createDiagnosticsReport } = await import("../lib/diagnostics/report.js");
const diagnosticsHandler = (await import("../api/diagnostics.js")).default;
const chatHandler = (await import("../api/chat.js")).default;
const { createSessionToken, SESSION_COOKIE_NAME } = await import(
  "../lib/auth/session.js"
);
const { resetHealthRateLimits } = await import("../lib/healthStatus.js");
const { resetVerificationSnapshot } = await import("../lib/aiProviders.js");
const {
  buildDebugPack,
  buildDebugPackJson,
  createUiLogCode,
} = await import("../src/utils/debugPack.js");

const API_KEY = "AIzaSyDIAGNOSTICSREDACTION123456789012";
const CONTROL_TOKEN = "diag-control-token-1234567890";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const HEX64 = "a".repeat(64);

function sessionCookie() {
  return `${SESSION_COOKIE_NAME}=${createSessionToken(process.env)}`;
}

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: null, writableEnded: false };
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
  resetLogStore();
  resetVerificationSnapshot();
  resetHealthRateLimits();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("maskSecrets removes keys, bearer tokens, JWTs and long hex digests", () => {
  const raw = [
    `gemini ${API_KEY}`,
    `openai sk-proj-abcdefghijklmnopqrstuvwx`,
    `Authorization: Bearer abc.def.ghi`,
    `api_key=${API_KEY}`,
    `token: super-secret-token`,
    `session_secret: ${HEX64}`,
    `cookie=gm_session.abcdef`,
    JWT,
    HEX64,
  ].join(" | ");

  const masked = maskSecrets(raw);

  for (const secret of [
    API_KEY,
    "sk-proj-abcdefghijklmnopqrstuvwx",
    "abc.def.ghi",
    "super-secret-token",
    JWT,
    HEX64,
  ]) {
    assert.equal(masked.includes(secret), false, `leaked ${secret}`);
  }
  assert.ok(masked.includes("[MASKED_API_KEY]"));
  assert.ok(masked.includes("[MASKED_JWT]"));
  assert.ok(masked.includes("[MASKED_HEX]"));
});

test("every log entry has a unique code, timestamp and root cause", () => {
  resetLogStore();
  const first = logEvent({
    level: "warn",
    event: "ai_chat_failed",
    errorCode: "AI_QUOTA_EXCEEDED",
    status: 429,
    durationMs: 12,
    message: "upstream said quota exceeded",
  });
  const second = logEvent({
    level: "error",
    event: "unhandled_error",
    message: `boom with ${API_KEY}`,
  });

  assert.match(first.code, /^GM-[0-9A-Z]+-[0-9A-Z]+$/);
  assert.match(second.code, /^GM-/);
  assert.notEqual(first.code, second.code);
  assert.ok(!Number.isNaN(Date.parse(first.ts)));
  assert.ok(first.ts.endsWith("Z"));
  assert.match(first.rootCause, /quota\/rate limit/i);
  assert.equal(first.errorCode, "AI_QUOTA_EXCEEDED");
  assert.equal(first.status, 429);
  assert.equal(second.level, "error");
  assert.equal(second.message.includes(API_KEY), false);
  assert.ok(second.rootCause.length > 0);
});

test("the ring buffer is bounded and recent logs come back oldest first", () => {
  resetLogStore();
  for (let index = 0; index < MAX_LOG_ENTRIES + 25; index += 1) {
    recordLog({ level: "info", event: "tick", message: `line ${index}` });
  }

  const info = getLogBufferInfo();
  assert.equal(info.size, MAX_LOG_ENTRIES);
  assert.equal(info.max, MAX_LOG_ENTRIES);
  assert.equal(info.scope, "process");

  const tail = getRecentLogs(5);
  assert.equal(tail.length, 5);
  assert.equal(tail.at(-1).message, `line ${MAX_LOG_ENTRIES + 24}`);
  assert.equal(tail[0].message, `line ${MAX_LOG_ENTRIES + 20}`);
  assert.deepEqual(getRecentLogs(0), []);
});

test("active errors contain only warn/error entries, newest first", () => {
  resetLogStore();
  recordLog({ level: "info", event: "healthy" });
  recordLog({ level: "warn", event: "first_warning", message: "warn one" });
  recordLog({ level: "error", event: "second_error", message: "err two" });

  const errors = getActiveErrors(10);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].event, "second_error");
  assert.equal(errors[1].event, "first_warning");
  assert.ok(errors.every((entry) => entry.code.startsWith("GM-")));
});

test("the diagnostics report carries statuses, stack, masked logs and no secrets", async () => {
  resetLogStore();
  resetVerificationSnapshot();
  const env = {
    ...process.env,
    GEMINI_API_KEY: API_KEY,
    GRANDMASTER_CONTROL_TOKEN: CONTROL_TOKEN,
    MT5_BRIDGE_URL: "",
  };
  recordLog({
    level: "warn",
    event: "ai_chat_failed",
    errorCode: "AI_AUTH_FAILED",
    message: `key ${API_KEY} rejected; Authorization: Bearer ${CONTROL_TOKEN}`,
  });

  let providerCalls = 0;
  const report = await createDiagnosticsReport({
    env,
    requestId: "req-diag-1",
    uptime: 42,
    now: 1_700_000_000_000,
    logLimit: 50,
    mt5TimeoutMs: 200,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("diagnostics must not call the provider");
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.service, "grandmaster-digital-hub");
  assert.equal(report.requestId, "req-diag-1");
  assert.equal(report.timestamp, new Date(1_700_000_000_000).toISOString());
  assert.equal(typeof report.services.backend.status, "string");
  assert.equal(report.services.doctor.simulated, true);
  assert.equal(report.services.doctor.scope, "browser-simulated");
  assert.equal(report.services.mt5.readOnly, true);
  assert.equal(report.services.mt5.tradingLocked, true);
  assert.equal(typeof report.stack.runtime.node, "string");
  assert.equal(typeof report.stack.packages.express, "string");
  assert.equal(report.logsInfo.scope, "process");
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].errorCode, "AI_AUTH_FAILED");
  assert.equal(report.limits.logLimit, 50);
  assert.match(report.privacy, /masked/i);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(serialized.includes(CONTROL_TOKEN), false);
  assert.equal(serialized.includes(dataDir), false);
  assert.equal(providerCalls, 0, "AI verification must stay cache-only");
});

test("Vercel diagnostics handler requires a session and clamps the limit", async () => {
  resetLogStore();
  resetHealthRateLimits();
  for (let index = 0; index < 8; index += 1) {
    recordLog({ level: "info", event: "tick", message: `line ${index}` });
  }

  const denied = fakeRes();
  await diagnosticsHandler(
    {
      method: "GET",
      url: "/api/diagnostics",
      headers: { "x-forwarded-for": "198.51.100.30" },
      socket: {},
    },
    denied,
  );
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body.code, "AUTH_REQUIRED");

  const wrongMethod = fakeRes();
  await diagnosticsHandler(
    {
      method: "POST",
      url: "/api/diagnostics",
      headers: {
        "x-forwarded-for": "198.51.100.31",
        cookie: sessionCookie(),
      },
      socket: {},
    },
    wrongMethod,
  );
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.allow, "GET, HEAD");

  const ok = fakeRes();
  await diagnosticsHandler(
    {
      method: "GET",
      url: "/api/diagnostics?limit=3",
      headers: {
        "x-forwarded-for": "198.51.100.32",
        cookie: sessionCookie(),
      },
      socket: {},
    },
    ok,
  );
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.logs.length, 3);
  assert.equal(ok.body.limits.logLimit, 3);
  assert.equal(ok.body.services.doctor.simulated, true);
  assert.ok(ok.headers["x-request-id"]);
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal(ok.headers["x-content-type-options"], "nosniff");
  resetHealthRateLimits();
});

test("the browser debug pack masks secrets and includes every section", () => {
  const uiCode = createUiLogCode();
  assert.match(uiCode, /^GMUI-[0-9A-Z]+-[0-9A-Z]+$/);
  assert.notEqual(uiCode, createUiLogCode());

  const diagnostics = {
    requestId: "req-ui-1",
    environment: { nodeEnv: "test", uptimeSeconds: 12, serverless: false },
    services: {
      backend: { status: "ONLINE", health: "GREEN", degraded: false },
      ai: { status: "verified", health: "GREEN", model: "test-model", cached: true },
      mt5: { status: "offline", readOnly: true, tradingLocked: true },
      storage: { status: "durable", durable: true },
      doctor: { scope: "browser-simulated", simulated: true },
    },
    stack: {
      runtime: { node: "v24.0.0", platform: "win32", arch: "x64", serverless: false },
      framework: "express",
      packages: { express: "5.1.0" },
    },
    errors: [
      {
        code: "GM-TEST-1",
        ts: "2026-10-28T10:00:00.000Z",
        level: "warn",
        event: "ai_chat_failed",
        message: `key ${API_KEY} failed`,
        rootCause: "Provider rejected the key.",
        errorCode: "AI_AUTH_FAILED",
      },
    ],
    logs: [
      {
        code: "GM-TEST-1",
        ts: "2026-10-28T10:00:00.000Z",
        level: "warn",
        event: "ai_chat_failed",
        message: `key ${API_KEY} failed`,
        rootCause: "Provider rejected the key.",
      },
    ],
    logsInfo: { size: 1, max: 500, scope: "process" },
  };
  const client = {
    build: { commitSha: "abc1234", buildTime: "2026-10-28T09:00:00.000Z" },
    backend: "ONLINE",
    aiStatus: "VERIFIED",
    aiDetail: { model: "test-model" },
    mt5: { status: "offline" },
    mic: {
      permission: "granted",
      deviceCount: 1,
      speechSupported: true,
      secureContext: true,
      checkedAt: "10:00:00",
    },
    isListening: true,
    doctor: { threats: [], lastScan: { status: "clean" } },
    uiLogs: [
      {
        code: "GMUI-TEST-1",
        ts: "2026-10-28T10:00:01.000Z",
        level: "error",
        message: "Backend health endpoint unavailable.",
        rootCause: "Backend health endpoint unavailable.",
      },
    ],
  };

  const pack = buildDebugPack({ diagnostics, client });
  for (const section of [
    "SERVICE STATUSES",
    "BACKEND STACK",
    "ACTIVE ERRORS",
    "SERVER LOG LINES",
    "CLIENT SNAPSHOT",
    "UI SESSION LOGS",
  ]) {
    assert.ok(pack.includes(section), `missing ${section}`);
  }
  assert.ok(pack.includes("GMUI-TEST-1"));
  assert.ok(pack.includes("SIMULATED"));
  assert.equal(pack.includes(API_KEY), false);
  assert.ok(pack.includes("[MASKED_API_KEY]"));

  const json = buildDebugPackJson({ diagnostics, client, serverError: "offline" });
  assert.equal(json.kind, "grandmaster-debug-pack");
  assert.equal(json.server.requestId, "req-ui-1");
  assert.equal(json.serverError, "offline");
  assert.equal(JSON.stringify(json).includes(API_KEY), false);
});

test("the UI wiring exposes Copy for Claude, downloads and /health", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const health = fs.readFileSync(
    path.join(process.cwd(), "src/pages/HealthPage.jsx"),
    "utf8",
  );
  const pack = fs.readFileSync(
    path.join(process.cwd(), "src/utils/debugPack.js"),
    "utf8",
  );

  assert.ok(app.includes("Copy for Claude"));
  assert.ok(app.includes("Download Logs (.txt)"));
  assert.ok(app.includes("Download Logs (.json)"));
  assert.ok(app.includes("/api/diagnostics?limit=50"));
  assert.ok(app.includes('{ id: "health"'));
  assert.ok(app.includes('"/health"'));
  assert.ok(app.includes("HealthPage"));
  assert.ok(app.includes("createUiLogCode()"));

  assert.ok(health.includes("Fresh check"));
  assert.ok(health.includes("SIMULATED"));
  assert.ok(health.includes("localhost"));
  assert.ok(health.includes("Microphone"));
  assert.ok(health.includes("System Doctor"));

  assert.ok(pack.includes("[MASKED_API_KEY]"));
  assert.ok(pack.includes("GMUI"));
  assert.doesNotMatch(pack, /localStorage/);
  assert.doesNotMatch(pack, /fetch\(/);
});

test("a failed AI chat is recorded once with a code and root cause", async () => {
  resetLogStore();
  const res = fakeRes();
  const body = { message: "hello" };

  await chatHandler(
    {
      method: "POST",
      url: "/api/chat",
      headers: {
        "x-forwarded-for": "198.51.100.40",
        "content-length": String(JSON.stringify(body).length),
        cookie: sessionCookie(),
      },
      body,
      socket: {},
    },
    res,
  );

  assert.ok([502, 503].includes(res.statusCode), `unexpected ${res.statusCode}`);
  const failures = getActiveErrors(5).filter(
    (entry) => entry.event === "ai_chat_failed",
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0].code, /^GM-/);
  assert.ok(failures[0].ts);
  assert.ok(failures[0].errorCode);
  assert.ok(failures[0].rootCause.length > 0);
  assert.equal(JSON.stringify(failures[0]).includes(API_KEY), false);
});
