import dns from "node:dns";
// Fix for slow/timeouting fetch on Windows: prefer IPv4 instead of waiting on broken IPv6.
dns.setDefaultResultOrder("ipv4first");

import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  executeProviderRotation,
  getProviderStatusList,
  parseProviders,
  verifyProvider,
} from "../lib/aiProviders.js";
import { getAllowedOrigins } from "../lib/cors.js";
import { handleV1 } from "../lib/api/v1.js";
import { AGENT_REGISTRY } from "../lib/agents/registry.js";
import { taskStore } from "../lib/tasks/taskStore.js";

const PORT = Number(process.env.PORT) || 5000;
const MAX_MESSAGE_CHARS = 8000;
const MAX_HISTORY_ITEMS = 12;
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
  app.use(express.json({ limit: "45mb" }));

  const allowedOrigins = getAllowedOrigins(process.env);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
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
      return res.status(429).json({
        error: "Too many requests. Please wait a minute and try again.",
      });
    }

    recent.push(now);
    hits.set(key, recent);
    return next();
  }

  app.get("/api/health", (_req, res) => {
    const providers = parseProviders(process.env);
    const statuses = getProviderStatusList(process.env);
    const [primaryProvider, primaryModel] = (providers[0] || "").split(":");
    const hasConfigured = statuses.some((s) => s.configured);
    const storage = taskStore.status();

    res.json({
      ok: true,
      status: "online",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      provider: primaryProvider || "gemini",
      model: primaryModel || "configured-model",
      aiConfigured: hasConfigured,
      providersCount: providers.length,
      agentsCount: AGENT_REGISTRY.length,
      storage: {
        mode: storage.mode,
        durable: storage.durable,
        ephemeral: storage.ephemeral,
        writable: storage.writable,
      },
    });
  });

  // Providers list & status snapshot endpoint
  app.get("/api/ai/providers", (_req, res) => {
    const providers = getProviderStatusList(process.env);
    res.json({
      providers,
      timestamp: new Date().toISOString(),
    });
  });

  // Real, meaningful provider verification (no "verified" claim on key presence alone).
  app.get("/api/ai/status", async (_req, res) => {
    const result = await verifyProvider(process.env);
    return res.json({
      status: result.status,
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
      const { message, history } = req.body || {};

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

      const safeHistory = (history || [])
        .slice(-MAX_HISTORY_ITEMS)
        .filter((item) => item && typeof item.content === "string")
        .map((item) => ({
          role: item.role === "user" ? "user" : "assistant",
          content: item.content.slice(0, MAX_MESSAGE_CHARS),
        }));

      const result = await executeProviderRotation({
        message: message.trim(),
        history: safeHistory,
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
