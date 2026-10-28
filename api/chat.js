import {
  MAX_MESSAGE_CHARS,
  answerChat,
  sanitizeChatHistory,
} from "../lib/aiProviders.js";
import { logEvent } from "../lib/logger.js";
import { prepare, requireSession, sendJson } from "../lib/vercelHttp.js";

const WINDOW_MS = 60_000;
const MAX_REQUESTS =
  Number(process.env.AI_RATE_LIMIT_PER_MINUTE) ||
  Number(process.env.RATE_LIMIT_PER_MINUTE) ||
  10;
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

export default async function handler(req, res) {
  const { clientKey, requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ error: "Method not allowed. Use POST.", requestId });
  }

  if (Number(req.headers?.["content-length"] || 0) > MAX_BODY_BYTES) {
    return res
      .status(413)
      .json({ error: "Request body is too large.", requestId });
  }

  if (!requireSession(req, res, process.env, requestId)) return;

  if (rateLimited(clientKey)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({
      error: "Too many requests. Please wait a minute.",
      requestId,
    });
  }

  const started = Date.now();
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res
        .status(400)
        .json({ error: "Request body must be a JSON object.", requestId });
    }
    const { message, history } = req.body;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "A non-empty 'message' string is required.",
        requestId,
      });
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({
        error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).`,
        requestId,
      });
    }
    if (history !== undefined && !Array.isArray(history)) {
      return res.status(400).json({ error: "'history' must be an array.", requestId });
    }

    const result = await answerChat({
      clientKey,
      message: message.trim(),
      history: sanitizeChatHistory(history),
      env: process.env,
    });

    logEvent({
      level: "info",
      event: "ai_chat",
      requestId,
      provider: result.provider,
      model: result.model,
      cached: Boolean(result.cached),
      durationMs: Date.now() - started,
      message: "Chat completion succeeded.",
    });

    return sendJson(res, 200, {
      reply: result.reply,
      provider: result.provider,
      model: result.model,
      cached: Boolean(result.cached),
      durationMs: Date.now() - started,
      attempts: result.attempts,
      requestId,
    });
  } catch (error) {
    const status = Number(error?.status) || 503;
    const retryAfter = Math.ceil(Number(error?.retryAfter));
    const headers =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? { "Retry-After": String(retryAfter) }
        : {};
    logEvent({
      level: "warn",
      event: "ai_chat_failed",
      requestId,
      errorCode: error?.code || "AI_PROVIDER_ERROR",
      status,
      durationMs: Date.now() - started,
      retryCount: Array.isArray(error?.attempts) ? error.attempts.length : 0,
      message: error?.message || "All AI providers failed.",
    });
    const httpStatus = [400, 401, 403, 404, 408, 413, 429, 499, 502, 503, 504].includes(
      status,
    )
      ? status
      : 503;
    return sendJson(
      res,
      httpStatus,
      {
        error: error?.message || "All AI providers failed.",
        code: error?.code || "AI_PROVIDER_ERROR",
        retryable: Boolean(error?.retryable),
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
        attempts: error?.attempts || [],
        fallbackUsed: Boolean(error?.fallbackUsed),
        cached: false,
        durationMs: Date.now() - started,
        requestId,
      },
      headers,
    );
  }
}
