import {
  checkHealthRateLimit,
  createHealthReport,
  healthRateLimitHeaders,
} from "../lib/healthStatus.js";
import { prepare, sendJson } from "../lib/vercelHttp.js";

// Public health endpoint. Never reveals secrets, environment variables or paths.
// It returns GREEN only for verified core + provider state, DEGRADED when a
// non-critical dependency is unavailable, and ERROR (503) when core checks fail.
export default async function handler(req, res) {
  const { clientKey } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
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
      },
      rateHeaders,
    );
  }

  const report = createHealthReport({ env: process.env });
  return sendJson(res, report.statusCode, report.body, rateHeaders);
}
