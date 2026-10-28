import {
  checkHealthRateLimit,
  createLivenessReport,
  healthRateLimitHeaders,
} from "../lib/healthStatus.js";
import { prepare, sendJson } from "../lib/vercelHttp.js";

// Public liveness endpoint. It only proves the process responds and never
// implies the AI provider, storage, MT5 or the control authority work.
// Private readiness lives at /api/health/readiness (session required).
export default async function handler(req, res) {
  const { clientKey, requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET.", requestId });
  }

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

  const report = createLivenessReport();
  return sendJson(
    res,
    report.statusCode,
    { ...report.body, requestId },
    rateHeaders,
  );
}
