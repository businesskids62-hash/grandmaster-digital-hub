/* ==========================================================================
   GRANDMASTER BACKEND — Gen 5 (CommonJS, Node 18+)
   Install:  npm i express cors dotenv
   Run:      node server.cjs
   .env:     GEMINI_API_KEY=...            (required)
             GEMINI_MODEL=gemini-2.5-flash (primary; use a model name valid for your key)
             GEMINI_FALLBACK_MODEL=        (optional second model)
             PORT=5000
             CORS_ORIGIN=http://localhost:5173
   ========================================================================== */

require("dotenv").config();
const dns = require("node:dns");
// Big fix for slow/timeouting fetch on Windows: prefer IPv4 instead of waiting on broken IPv6.
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");

const PORT = Number(process.env.PORT) || 5000;
const API_KEY = process.env.GEMINI_API_KEY || "";
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "";
const CORS_ORIGINS = (process.env.CORS_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((s) => s.trim()).filter(Boolean);

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const ATTEMPT_TIMEOUT_MS = 35000;   // per provider attempt (2 attempts max < frontend's 90s)
const PROBE_TIMEOUT_MS = 6000;
const PROBE_EVERY_MS = 60000;
const MAX_HISTORY = 12;
const MAX_ATTACHMENTS = 5;
const MAX_MESSAGE_CHARS = 20000;
const RATE_LIMIT = { windowMs: 60000, max: 40 };
const MAX_CONCURRENT_AI = 6;

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

/* ----------------------------- provider status ---------------------------- */

const providerState = { ok: null, checkedAt: 0, latencyMs: null, error: "" };

async function timedFetch(url, options = {}, timeoutMs = ATTEMPT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Lightweight metadata call (no tokens used). Runs in background; /api/health never waits on it.
async function probeProvider() {
  if (!API_KEY) {
    Object.assign(providerState, { ok: false, checkedAt: Date.now(), latencyMs: null, error: "GEMINI_API_KEY missing" });
    return;
  }
  const started = Date.now();
  try {
    const res = await timedFetch(
      `${GEMINI_BASE}/models/${encodeURIComponent(PRIMARY_MODEL)}`,
      { headers: { "x-goog-api-key": API_KEY } },
      PROBE_TIMEOUT_MS,
    );
    const ok = res.ok;
    let error = "";
    if (!ok) error = res.status === 404 ? `Model "${PRIMARY_MODEL}" not found for this key` : `Provider HTTP ${res.status}`;
    Object.assign(providerState, { ok, checkedAt: Date.now(), latencyMs: Date.now() - started, error });
  } catch (e) {
    Object.assign(providerState, {
      ok: false, checkedAt: Date.now(), latencyMs: null,
      error: e.name === "AbortError" ? "Provider probe timed out (network to Google is slow/blocked)" : `Provider unreachable: ${e.message}`,
    });
  }
}

/* ------------------------------- Gemini call ------------------------------ */

class ProviderError extends Error {
  constructor(message, status, retryable) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

function buildContents(history, message, attachments) {
  const turns = [];
  for (const item of history.slice(-MAX_HISTORY)) {
    const role = item?.role === "user" ? "user" : "model";
    const text = typeof item?.content === "string" ? item.content.slice(0, MAX_MESSAGE_CHARS) : "";
    if (!text.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.parts.push({ text });   // Gemini needs alternating roles
    else turns.push({ role, parts: [{ text }] });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();  // must start with user

  const userParts = [{ text: message }];
  for (const a of attachments) userParts.push({ inline_data: { mime_type: a.type, data: a.data } });
  const last = turns[turns.length - 1];
  if (last && last.role === "user") last.parts.push(...userParts);
  else turns.push({ role: "user", parts: userParts });
  return turns;
}

async function callGemini(model, { system, contents }) {
  const body = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  let res;
  try {
    res = await timedFetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === "AbortError") throw new ProviderError("AI provider request timed out.", 504, true);
    throw new ProviderError(`AI provider unreachable: ${e.message}`, 502, true);
  }

  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
    const retryable = [429, 500, 502, 503, 504].includes(res.status);
    const msg =
      res.status === 400 && /api key/i.test(detail) ? "Invalid API key."
      : res.status === 403 ? "API key not allowed for this model/region."
      : res.status === 404 ? `Model "${model}" not found.`
      : res.status === 429 ? "AI quota/rate limit reached. Thori der baad try karein."
      : `AI provider error (${res.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`;
    throw new ProviderError(msg, res.status === 429 ? 429 : 502, retryable);
  }

  const data = await res.json();
  if (data?.promptFeedback?.blockReason) {
    throw new ProviderError(`Request blocked by safety filter (${data.promptFeedback.blockReason}).`, 422, false);
  }
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) {
    throw new ProviderError(
      cand?.finishReason && cand.finishReason !== "STOP" ? `Empty reply (${cand.finishReason}).` : "AI returned an empty reply.",
      502, true,
    );
  }
  return text;
}

async function generate(payload) {
  const models = [PRIMARY_MODEL];
  if (FALLBACK_MODEL && FALLBACK_MODEL !== PRIMARY_MODEL) models.push(FALLBACK_MODEL);
  else models.push(PRIMARY_MODEL); // one quick retry on the same model

  let lastError;
  for (let i = 0; i < models.length; i += 1) {
    try {
      const started = Date.now();
      const text = await callGemini(models[i], payload);
      return { text, model: models[i], ms: Date.now() - started };
    } catch (e) {
      lastError = e;
      log(`[ai] attempt ${i + 1} (${models[i]}) failed: ${e.status || ""} ${e.message}`);
      if (!e.retryable) break;
      if (i < models.length - 1) await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw lastError;
}

/* --------------------------------- server --------------------------------- */

/* --------------------------------- server --------------------------------- */

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(cors({
  origin(origin, cb) {
    if (!origin || CORS_ORIGINS.includes(origin) || CORS_ORIGINS.includes("*")) return cb(null, true);
    return cb(new Error(`Origin not allowed: ${origin}`));
  },
}));
app.use(express.json({ limit: "45mb" })); // 5 files x 8 MB as base64
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  const started = Date.now();
  res.on("finish", () => log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`));
  next();
});

// Tiny in-memory rate limiter.
const hits = new Map();
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT.windowMs;
  for (const [ip, arr] of hits) {
    const fresh = arr.filter((t) => t > cutoff);
    if (fresh.length) hits.set(ip, fresh); else hits.delete(ip);
  }
}, 30000).unref();

function rateLimit(req, res, next) {
  const now = Date.now();
  const arr = (hits.get(req.ip) || []).filter((t) => t > now - RATE_LIMIT.windowMs);
  if (arr.length >= RATE_LIMIT.max) {
    res.setHeader("Retry-After", "30");
    return res.status(429).json({ error: "Bohat zyada requests. Thori der baad try karein." });
  }
  arr.push(now);
  hits.set(req.ip, arr);
  return next();
}

// Instant. Never waits on the AI provider.
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    primary: PRIMARY_MODEL,
    model: PRIMARY_MODEL,
    keyConfigured: Boolean(API_KEY),
    uptimeSec: Math.round(process.uptime()),
    provider: {
      ok: providerState.ok,
      latencyMs: providerState.latencyMs,
      checkedAt: providerState.checkedAt || null,
      error: providerState.error || undefined,
    },
  });
});

let activeAi = 0;

app.post("/api/chat", rateLimit, async (req, res) => {
  const body = req.body || {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = Array.isArray(body.history) ? body.history : [];
  const system = typeof body.system === "string" ? body.system.slice(0, 2000) : "";
  const memory = Array.isArray(body.memory)
    ? body.memory.filter((m) => typeof m === "string").slice(0, 20).map((m) => m.slice(0, 500))
    : [];
  const rawAttachments = Array.isArray(body.attachments) ? body.attachments.slice(0, MAX_ATTACHMENTS) : [];
  const attachments = rawAttachments.filter(
    (a) => a && typeof a.type === "string" && typeof a.data === "string" && a.data.length > 0,
  );

  if (!message) return res.status(400).json({ error: "Message is required." });
  if (message.length > MAX_MESSAGE_CHARS) return res.status(413).json({ error: "Message bohat lamba hai." });
  if (!API_KEY) return res.status(503).json({ error: "Server par GEMINI_API_KEY set nahi hai (.env check karein)." });
  if (activeAi >= MAX_CONCURRENT_AI) return res.status(503).json({ error: "Server busy hai. Chand seconds baad try karein." });

  const systemText = [system, memory.length ? `User memory:\n- ${memory.join("\n- ")}` : ""].filter(Boolean).join("\n\n");

  activeAi += 1;
  let aborted = false;
  res.on("close", () => { if (!res.writableEnded) aborted = true; });
  try {
    const out = await generate({ system: systemText, contents: buildContents(history, message, attachments) });
    if (aborted) return undefined;
    return res.json({ reply: out.text, model: out.model, ms: out.ms });
  } catch (e) {
    if (aborted) return undefined;
    return res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message || "AI request failed." });
  } finally {
    activeAi -= 1;
  }
});
app.use((req, res) => res.status(404).json({ error: "Not found." }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Attachments bohat bari hain." });
  if (err instanceof SyntaxError) return res.status(400).json({ error: "Invalid JSON." });
  log("[server] error:", err.message);
  return res.status(500).json({ error: err.message || "Server error." });
});

const server = app.listen(PORT, () => {
  log(`Grandmaster server listening on http://localhost:${PORT}`);
  log(`AI provider: gemini (${PRIMARY_MODEL})${FALLBACK_MODEL ? ` · fallback ${FALLBACK_MODEL}` : ""}`);
  if (!API_KEY) log("WARNING: GEMINI_API_KEY is not set.");
  probeProvider().then(() =>
    log(`[ai] probe: ${providerState.ok ? `OK ${providerState.latencyMs}ms` : `FAILED - ${providerState.error}`}`),
  );
  setInterval(probeProvider, PROBE_EVERY_MS).unref();
});
server.keepAliveTimeout = 65000;

process.on("unhandledRejection", (r) => log("[server] unhandledRejection:", r));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { log(`${sig} received, shutting down.`); server.close(() => process.exit(0)); });
}