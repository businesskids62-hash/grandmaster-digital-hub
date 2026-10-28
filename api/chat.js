import {
  CHAT_SYSTEM_PROMPT,
  MAX_MESSAGE_CHARS,
  executeProviderRotation,
  sanitizeChatHistory,
} from "../lib/aiProviders.js";
import { prepare, sendJson } from "../lib/vercelHttp.js";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_PER_MINUTE) || 30;
const MAX_BODY_BYTES = 64 * 1024;
const hits = new Map();

// Best-effort per-instance limiter. Serverless instances are ephemeral,
// so this is a safety net rather than a durable quota.
function rateLimited(clientKey) {
  const now = Date.now();
  const recent = (hits.get(clientKey) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    hits.set(clientKey, recent);
    return true;
  }
  recent.push(now);
  hits.set(clientKey, recent);
  if (hits.size > 1000) hits.clear();
  return false;
}

const SYSTEM_PROMPT = CHAT_SYSTEM_PROMPT;

export default async function handler(req, res) {
  const { clientKey } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  if (Number(req.headers?.["content-length"] || 0) > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "Request body is too large." });
  }

  if (rateLimited(clientKey)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  }

  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Request body must be a JSON object." });
    }
    const { message, history } = req.body;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "A non-empty 'message' string is required." });
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({
        error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).`,
      });
    }
    if (history !== undefined && !Array.isArray(history)) {
      return res.status(400).json({ error: "'history' must be an array." });
    }

    const result = await executeProviderRotation({
      message: message.trim(),
      history: sanitizeChatHistory(history),
      systemPrompt: SYSTEM_PROMPT,
      env: process.env,
    });

    return sendJson(res, 200, {
      reply: result.reply,
      provider: result.provider,
      model: result.model,
      attempts: result.attempts,
    });
  } catch (error) {
    const status = Number(error?.status) || 503;
    const attempts = error?.attempts || [];
    return sendJson(
      res,
      status >= 400 && status < 500 ? status : 503,
      {
        error: error?.message || "All AI providers failed.",
        code: error?.code || "AI_PROVIDER_ERROR",
        retryable: Boolean(error?.retryable),
        attempts,
      },
    );
  }
}
