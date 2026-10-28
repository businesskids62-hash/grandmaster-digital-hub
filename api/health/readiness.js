import {
  checkHealthRateLimit,
  createHealthReport,
  healthRateLimitHeaders,
} from "../../lib/healthStatus.js";
import { verifyProviderCached } from "../../lib/aiProviders.js";
import { prepare, requireSession, sendJson } from "../../lib/vercelHttp.js";

// Private readiness. Requires the signed session cookie because it exposes
// configuration-level state. 200 never implies the AI provider works; only a
// fresh live verification (cached at most 1/60s) can report GREEN.
export default async function handler(req, res) {
  const { clientKey, requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET.", requestId });
  }

  if (!requireSession(req, res, process.env, requestId)) return;

  const rate = checkHealthRateLimit(clientKey, process.env);
  const rateHeaders = healthRateLimitHeaders(rate);
  if (!rate.allowed) {
    return sendJson(
      res,
      429,
      {
        ok: false,
        error: "Too many health requests. Try again in a minute.",
        code: "HEALTH_RATE_LIMITED",
        requestId,
      },
      rateHeaders,
    );
  }

  // One tiny cached provider call at most once per 60s; never per page render.
  void verifyProviderCached(process.env, {
    timeoutMs: 28_000,
    maxRetries: 0,
    background: true,
  });

  const report = createHealthReport({ env: process.env });
  return sendJson(
    res,
    report.statusCode,
    { ...report.body, requestId },
    rateHeaders,
  );
}
