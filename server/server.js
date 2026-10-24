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
  PROVIDER_DEFAULTS,
} from "../lib/aiProviders.js";
import { getAllowedOrigins } from "../lib/cors.js";

const PORT = Number(process.env.PORT) || 5000;
const MAX_MESSAGE_CHARS = 8000;
const MAX_HISTORY_ITEMS = 12;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_PER_MINUTE) || 60;

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
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
    const primary = providers[0] || { provider: "gemini", model: "gemini-3.6-flash" };
    const hasConfigured = statuses.some((s) => s.configured);

    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      provider: primary.provider,
      model: primary.model,
      aiConfigured: hasConfigured,
      providersCount: providers.length,
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

  // Lightweight AI provider verification
  app.get("/api/ai/status", async (_req, res) => {
    const providers = getProviderStatusList(process.env);
    const primary = providers[0];

    if (!primary || !primary.configured) {
      return res.json({
        status: "failed",
        reason: "GEMINI_API_KEY / AI_API_KEY is not set in server/.env.",
        model: primary?.model || "unknown",
        providers,
      });
    }

    const key = (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || "").trim();
    const started = Date.now();
    let reply = "";
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 10000);
      const url = `${PROVIDER_DEFAULTS.gemini.baseUrl}/models/${encodeURIComponent(primary.model)}:generateContent`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
          generationConfig: { maxOutputTokens: 256 },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      timer = null;

      if (response.ok) {
        try {
          const data = await response.json();
          reply = (data?.candidates?.[0]?.content?.parts || [])
            .map((p) => p?.text || "")
            .join("");
        } catch {}
        if (reply.trim()) {
          return res.json({
            status: "verified",
            reason: "",
            model: primary.model,
            latencyMs: Date.now() - started,
            providers,
          });
        }
      }

      let detail = "";
      try {
        if (!response.ok) {
          detail = (await response.json())?.error?.message || "";
        }
      } catch {}

      const emptyReply = response.ok && !reply.trim();

      const reason = emptyReply
        ? "Gemini returned an empty response."
        : response.status === 400 || response.status === 403
          ? `Invalid API key or key not allowed for this model (HTTP ${response.status}).`
          : response.status === 404
          ? `Model "${primary.model}" not found for this key.`
          : response.status === 429
          ? "Gemini quota/rate limit reached."
          : `Gemini returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`;

      return res.json({ status: "failed", reason, model: primary.model, providers });
    } catch (error) {
      if (timer) clearTimeout(timer);
      const reason =
        error.name === "AbortError"
          ? "Request to Gemini timed out after 10s."
          : `Gemini unreachable: ${error.message}`;
      return res.json({ status: "failed", reason, model: primary.model, providers });
    }
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
  const primary = providers[0] || { provider: "gemini", model: "gemini-3.6-flash" };

  app.listen(PORT, () => {
    console.log("Grandmaster Backend Running - Cline bypass OK");
    console.log(`Grandmaster server listening on http://localhost:${PORT}`);
    console.log(`Configured AI providers (${providers.length}): ${providers.map((p) => p.id).join(", ")}`);
  });
}
