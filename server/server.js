import dns from "node:dns";
// Fix for slow/timeouting fetch on Windows: prefer IPv4 instead of waiting on broken IPv6.
dns.setDefaultResultOrder("ipv4first");

import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  CHAT_SYSTEM_PROMPT,
  MAX_MESSAGE_CHARS,
  executeProviderRotation,
  getProviderStatusList,
  getVerificationSnapshot,
  parseProviders,
  providerHealthLabel,
  sanitizeChatHistory,
  verifyProvider,
} from "../lib/aiProviders.js";
import { getAllowedOrigins } from "../lib/cors.js";
import { handleV1 } from "../lib/api/v1.js";
import {
  checkHealthRateLimit,
  createHealthReport,
  healthRateLimitHeaders,
} from "../lib/healthStatus.js";

const PORT = Number(process.env.PORT) || 5000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_PER_MINUTE) || 60;

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  const allowedOrigins = getAllowedOrigins(process.env);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Origin not allowed by CORS."));
      },
      credentials: true,
    }),
  );

  // In-memory rate limiter for the chat endpoint
  const hits = new Map();
  function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || "unknown";
    const recent = (hits.get(key) || []).filter(
      (time) => now - time < RATE_LIMIT_WINDOW_MS,
    );

    if (recent.length >= RATE_LIMIT_MAX) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({
        error: "Too many requests. Please wait a minute and try again.",
        retryAfter: 60,
      });
    }

    recent.push(now);
    hits.set(key, recent);
    return next();
  }

  app.all("/api/health", (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).json({ error: "Method not allowed. Use GET." });
    }

    const rate = checkHealthRateLimit(req.ip, process.env);
    for (const [key, value] of Object.entries(healthRateLimitHeaders(rate))) {
      res.setHeader(key, value);
    }
    res.setHeader("Cache-Control", "no-store");

    if (!rate.allowed) {
      return res.status(429).json({
        ok: false,
        error: "Too many health requests. Try again in a minute.",
        code: "HEALTH_RATE_LIMITED",
      });
    }

    const report = createHealthReport({
      env: process.env,
      uptime: process.uptime(),
    });
    return res.status(report.statusCode).json(report.body);
  });

  // Providers list & status snapshot endpoint
  app.get("/api/ai/providers", (_req, res) => {
    const snapshot = getVerificationSnapshot();
    const providers = getProviderStatusList(process.env).map((item) => ({
      ...item,
      health: providerHealthLabel(item, snapshot),
    }));
    res.json({
      providers,
      timestamp: new Date().toISOString(),
    });
  });

  // Real, meaningful provider verification (no "verified" claim on key presence alone).
  app.get("/api/ai/status", async (_req, res) => {
    const result = await verifyProvider(process.env);
    const configured = result.providers?.some((item) => item.configured);
    return res.json({
      status: result.status,
      health: configured
        ? result.status === "verified"
          ? "GREEN"
          : "CAPABILITY NOT VERIFIED"
        : "NOT CONNECTED",
      reason: result.reason || "",
      provider: result.provider || "gemini",
      model: result.model,
      latencyMs: result.latencyMs,
      providers: result.providers,
    });
  });

  // Phase 3 core API. Shared with the Vercel serverless adapter.
  app.use("/api/v1", async (req, res) => {
    const url = new URL(req.originalUrl, "http://localhost");
    const result = await handleV1({
      method: req.method,
      path: url.pathname.replace(/^\/api\/v1/, ""),
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body: req.body,
      env: process.env,
      clientKey: req.ip,
    });
    res.setHeader("X-Request-Id", result.requestId);
    res.setHeader("Cache-Control", "no-store");
    for (const [key, value] of Object.entries(result.headers || {})) {
      res.setHeader(key, value);
    }
    return res.status(result.status).json(result.body);
  });

  app.post("/api/chat", rateLimit, async (req, res, next) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ error: "Request body must be a JSON object." });
      }
      const { message, history } = req.body;

      if (typeof message !== "string" || !message.trim()) {
        return res
          .status(400)
          .json({ error: "A non-empty 'message' string is required." });
      }

      if (message.length > MAX_MESSAGE_CHARS) {
        return res.status(400).json({
          error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).`,
        });
      }

      if (history !== undefined && !Array.isArray(history)) {
        return res.status(400).json({ error: "'history' must be an array." });
      }

      const safeHistory = sanitizeChatHistory(history);

      const result = await executeProviderRotation({
        message: message.trim(),
        history: safeHistory,
        systemPrompt: CHAT_SYSTEM_PROMPT,
        env: process.env,
      });

      return res.json({
        reply: result.reply,
        provider: result.provider,
        model: result.model,
        attempts: result.attempts,
      });
    } catch (error) {
      if (error.status === 503) {
        return res.status(503).json({
          error: error.message || "All AI providers failed.",
          attempts: error.attempts || [],
        });
      }
      return next(error);
    }
  });

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Endpoint not found." });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error?.status) {
      return res.status(error.status).json({
        error: error.message,
        attempts: error.attempts || [],
      });
    }

    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Request body is not valid JSON." });
    }

    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body is too large." });
    }

    if (error?.message === "Origin not allowed by CORS.") {
      return res.status(403).json({ error: error.message });
    }

    console.error("[server] Unexpected error:", error);
    return res.status(500).json({ error: "Internal server error." });
  });

  return app;
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  const app = createApp();
  const providers = parseProviders(process.env);
  const [primaryProvider, primaryModel] = (providers[0] || "").split(":");

  app.listen(PORT, () => {
    console.log("Grandmaster Backend Running - Cline bypass OK");
    console.log(`Grandmaster server listening on http://localhost:${PORT}`);
    console.log(`Configured AI providers (${providers.length}): ${providers.join(", ")}`);
    console.log(`Primary provider: ${primaryProvider || "gemini"} / ${primaryModel || "configured-model"}`);
  });
}
