import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vercel Hobby caps a deployment at 12 Serverless Functions, so the per-endpoint
// adapters under api/auth, api/health and api/ai were folded into three
// catch-all routes. These tests lock the cap, the dispatch, and — most
// importantly — the fail-closed guards the removed adapters enforced.
const HOBBY_FUNCTION_LIMIT = 12;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grandmaster-vercel-endpoints-"));
process.env.GRANDMASTER_DATA_DIR = dataDir;
process.env.GRANDMASTER_CONTROL_TOKEN = "vcle-control-token-1234567890";
process.env.GRANDMASTER_UI_PASSWORD = "vcle-ui-password-123";
process.env.GRANDMASTER_SESSION_SECRET =
  "vcle-session-secret-0123456789abcdef0123456789";
process.env.GRANDMASTER_LOG_SILENT = "1";
process.env.HEALTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.AI_RATE_LIMIT_PER_MINUTE = "1000";
process.env.AUTH_RATE_LIMIT_PER_MINUTE = "1000";
process.env.CORS_ALLOWED_ORIGINS = "https://grandmaster-digital-hub.vercel.app";
process.env.AI_PROVIDERS = "gemini:test-model";
process.env.GEMINI_API_KEY = "";
process.env.AI_API_KEY = "";

const {
  endpointSegment,
  handleAiEndpoint,
  handleAuthEndpoint,
  handleHealthEndpoint,
} = await import("../lib/vercel/endpoints.js");
const { SESSION_COOKIE_NAME, createSessionToken } = await import("../lib/auth/session.js");
const { resetAuthRateLimits } = await import("../lib/auth/routes.js");
const { resetHealthRateLimits } = await import("../lib/healthStatus.js");
const { resetVerificationSnapshot } = await import("../lib/aiProviders.js");

const authCatchAll = (await import("../api/auth/[...path].js")).default;
const healthCatchAll = (await import("../api/health/[...path].js")).default;
const aiCatchAll = (await import("../api/ai/[...path].js")).default;

after(() => {
  resetAuthRateLimits();
  resetHealthRateLimits();
  resetVerificationSnapshot();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

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

function makeRequest({ method = "GET", url = "/api/health/ai", headers = {}, body = undefined } = {}) {
  return {
    method,
    url,
    headers,
    body,
    socket: { remoteAddress: "127.0.0.1" },
  };
}

async function invoke(handler, request) {
  const res = fakeRes();
  await handler(request, res);
  return res;
}

function sessionHeaders(extra = {}) {
  return {
    cookie: `${SESSION_COOKIE_NAME}=${createSessionToken(process.env)}`,
    ...extra,
  };
}

function apiFunctionFiles() {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".js") ? [full] : [];
    });
  return walk(path.join(repoRoot, "api")).map((file) =>
    path.relative(repoRoot, file).split(path.sep).join("/"),
  );
}

test("api deployment stays inside the Vercel Hobby Serverless Function cap", () => {
  const files = apiFunctionFiles().sort();
  assert.ok(files.length <= HOBBY_FUNCTION_LIMIT,
    `api/ exposes ${files.length} functions, cap is ${HOBBY_FUNCTION_LIMIT}: ${files.join(", ")}`);
  assert.ok(files.length > 0, "api/ must still expose the deployed endpoints");

  for (const required of [
    "api/health.js",
    "api/chat.js",
    "api/diagnostics.js",
    "api/v1/[...path].js",
    "api/academy/[...path].js",
    "api/admin/stats.js",
    "api/ai-status.js",
    "api/providers.js",
    "api/auth/[...path].js",
    "api/health/[...path].js",
    "api/ai/[...path].js",
  ]) {
    assert.ok(files.includes(required), `${required} must exist after consolidation`);
  }

  // The consolidated routes must not keep per-endpoint files: each one would
  // cost another Serverless Function and re-break the deployment.
  for (const dir of ["api/auth", "api/health", "api/ai"]) {
    const strays = files.filter(
      (file) => file.startsWith(`${dir}/`) && file !== `${dir}/[...path].js`,
    );
    assert.deepEqual(strays, [], `${dir} must contain only the catch-all route`);
  }
});

test("endpointSegment accepts one known segment and rejects everything else", () => {
  assert.equal(endpointSegment("/api/auth/login", "/api/auth"), "login");
  assert.equal(endpointSegment("/api/health/readiness", "/api/health"), "readiness");
  assert.equal(endpointSegment("/api/ai/status", "/api/ai"), "status");

  assert.equal(endpointSegment("/api/health/ai", "/api/health"), "ai");
  // A trailing slash normalises to the same known endpoint; it cannot reach
  // another one, because the extra empty part is dropped.
  assert.equal(endpointSegment("/api/auth/login/", "/api/auth"), "login");

  for (const pathname of [
    "/api/auth",
    "/api/auth/login/session",
    "/api/auth/../admin/stats",
    "/api/auth/%2e%2e/session",
    "/api/health/ai/mt5",
    "/api/ai/status/force",
    "/api/academy/lessons",
  ]) {
    const prefix = pathname.startsWith("/api/health") ? "/api/health"
      : pathname.startsWith("/api/ai") ? "/api/ai"
        : pathname.startsWith("/api/auth") ? "/api/auth"
          : "/api/other";
    assert.equal(endpointSegment(pathname, prefix), null, `${pathname} must not resolve`);
  }
});

test("catch-all routes answer JSON 404 for unknown endpoints instead of leaking through", async () => {
  for (const [handler, url] of [
    [authCatchAll, "/api/auth/%2e%2e"],
    [authCatchAll, "/api/auth/../../admin/stats"],
    [authCatchAll, "/api/auth/nope"],
    [healthCatchAll, "/api/health/nope"],
    [aiCatchAll, "/api/ai/nope"],
  ]) {
    const res = await invoke(handler, makeRequest({ url, headers: sessionHeaders() }));
    assert.equal(res.statusCode, 404, `${url} must be 404`);
    assert.equal(res.body.code, "ENDPOINT_NOT_FOUND", `${url} must use the shared code`);
    assert.equal(res.body.ok, false);
    // Nothing about the filesystem or the store may surface in a miss.
    assert.doesNotMatch(JSON.stringify(res.body), /(?:[A-Za-z]:\\|\/tmp\/|\/var\/|grandmaster-data|\.db)/);
  }
});

test("auth catch-all reproduces the method guards of the removed adapters", async () => {
  const logout = await invoke(authCatchAll, makeRequest({ url: "/api/auth/logout" }));
  assert.equal(logout.statusCode, 405);
  assert.equal(logout.headers.allow, "POST");

  const session = await invoke(authCatchAll, makeRequest({ method: "POST", url: "/api/auth/session" }));
  assert.equal(session.statusCode, 405);
  assert.equal(session.headers.allow, "GET, HEAD");

  const login = await invoke(
    authCatchAll,
    makeRequest({ method: "POST", url: "/api/auth/login", body: JSON.stringify({}) }),
  );
  assert.ok([400, 401, 429].includes(login.statusCode), `login must reject an empty body, got ${login.statusCode}`);
  assert.notEqual(login.body?.code, "ENDPOINT_NOT_FOUND", "login must stay routed");
});

test("private catch-all endpoints stay fail-closed without a session", async () => {
  resetHealthRateLimits();
  for (const [handler, url] of [
    [healthCatchAll, "/api/health/ai"],
    [healthCatchAll, "/api/health/storage"],
    [healthCatchAll, "/api/health/mt5"],
    [healthCatchAll, "/api/health/readiness"],
    [aiCatchAll, "/api/ai/providers"],
    [aiCatchAll, "/api/ai/status"],
  ]) {
    const res = await invoke(handler, makeRequest({ url }));
    assert.equal(res.statusCode, 401, `${url} must require the signed session, got ${res.statusCode}`);
    assert.equal(res.body.code, "AUTH_REQUIRED");
    assert.equal(res.headers["content-security-policy"],
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      `${url} must keep the API CSP`);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
  }

  const postProviders = await invoke(aiCatchAll, makeRequest({ method: "POST", url: "/api/ai/providers" }));
  assert.equal(postProviders.statusCode, 405, "method guard still runs before authentication");
});

test("session-guarded endpoints answer once a valid session exists", async () => {
  resetHealthRateLimits();
  const readiness = await invoke(
    healthCatchAll,
    makeRequest({ url: "/api/health/readiness", headers: sessionHeaders() }),
  );
  assert.equal(readiness.statusCode, 200, `readiness body: ${JSON.stringify(readiness.body)}`);
  assert.ok(readiness.body.requestId, "readiness must still carry the request id");

  const aiReport = await invoke(
    healthCatchAll,
    makeRequest({ url: "/api/health/ai", headers: sessionHeaders() }),
  );
  assert.notEqual(aiReport.statusCode, 401);
  assert.notEqual(aiReport.statusCode, 404);
  assert.equal(typeof aiReport.body?.status, "string",
    `ai health must report an honest status string, got ${JSON.stringify(aiReport.body)}`);
});

test("Vercel SPA fallback never shadows /api/ GET requests", () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf-8"));
  const fallbacks = (config.rewrites || []).filter((rule) => rule.destination === "/index.html");
  assert.equal(fallbacks.length, 1, "exactly one SPA fallback rewrite");

  // Vercel source patterns of this shape translate 1:1 to a JS regex anchored at
  // both ends, so the negative lookahead can be checked against real paths.
  const matcher = new RegExp(`^${fallbacks[0].source}$`);
  for (const publicPath of ["/", "/academy", "/login", "/signup", "/tasks/123"]) {
    assert.ok(matcher.test(publicPath), `${publicPath} must fall back to the SPA shell`);
  }
  // A swallowed GET answers index.html while the method still reaches the
  // function, which is why POST-only checks never caught this in production.
  for (const apiPath of [
    "/api/health",
    "/api/health/readiness",
    "/api/health/ai",
    "/api/auth/session",
    "/api/auth/login",
    "/api/ai/providers",
    "/api/v1/status",
    "/api/academy/lessons",
  ]) {
    assert.equal(matcher.test(apiPath), false, `${apiPath} must reach its serverless function`);
  }

  const headerSources = (config.headers || []).map((rule) => rule.source);
  assert.ok(headerSources.includes("/api/(.*)"), "API CSP rule must still target /api/(.*)");
  assert.ok(headerSources.includes("/(.*)"), "page header rules must still target /(.*)");
});

test("missing session authority fails closed through the consolidated routes", async () => {
  const previous = process.env.GRANDMASTER_SESSION_SECRET;
  const headers = sessionHeaders();
  process.env.GRANDMASTER_SESSION_SECRET = "";
  try {
    const res = await invoke(
      healthCatchAll,
      makeRequest({ url: "/api/health/readiness", headers }),
    );
    assert.equal(res.statusCode, 503, "unconfigured authority must never grant access");
    assert.equal(res.body.code, "AUTH_NOT_CONFIGURED");
  } finally {
    process.env.GRANDMASTER_SESSION_SECRET = previous;
  }
});
