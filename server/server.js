import "dotenv/config";
import express from "express";
import cors from "cors";
import { AIError, generateReply, getAIConfig } from "./services/aiAdapter.js";

const PORT = Number(process.env.PORT) || 3001;
const MAX_MESSAGE_CHARS = 8000;
const MAX_HISTORY_ITEMS = 12;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_PER_MINUTE) || 30;

const allowedOrigins = (
  process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin / non-browser requests (no Origin header) and listed origins.
        if (!origin || allowedOrigins.includes(origin))
          return callback(null, true);
        return callback(new Error("Origin not allowed by CORS."));
      },
    }),
  );

  // Simple in-memory rate limiter for the chat endpoint.
  const hits = new Map();
  function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || "unknown";
    const recent = (hits.get(key) || []).filter(
      (time) => now - time < RATE_LIMIT_WINDOW_MS,
    );

    if (recent.length >= RATE_LIMIT_MAX) {
      return res
        .status(429)
        .json({
          error: "Too many requests. Please wait a minute and try again.",
        });
    }

    recent.push(now);
    hits.set(key, recent);
    return next();
  }

  app.get("/api/health", (req, res) => {
    const config = getAIConfig();

    res.json({
      status: "ok",
      aiConfigured: config.configured,
      provider: config.provider,
      // Shown as the "model" label in the dashboard.
      model: config.configured
        ? `${config.provider} · ${config.model}`
        : "AI not configured",
      time: new Date().toISOString(),
    });
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
        return res
          .status(400)
          .json({
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

      const reply = await generateReply({
        message: message.trim(),
        history: safeHistory,
      });
      return res.json({ reply });
    } catch (error) {
      return next(error);
    }
  });

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Endpoint not found." });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof AIError) {
      console.error(`[ai] ${error.status} ${error.message}`);
      return res.status(error.status).json({ error: error.message });
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
  const config = getAIConfig();

  app.listen(PORT, () => {
    console.log(`Grandmaster server listening on http://localhost:${PORT}`);
    console.log(
      config.configured
        ? `AI provider: ${config.provider} (${config.model})`
        : `AI provider NOT ready: ${config.problem}`,
    );
  });
}
