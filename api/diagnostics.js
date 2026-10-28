import { createDiagnosticsReport } from "../lib/diagnostics/report.js";
import { checkHealthRateLimit, healthRateLimitHeaders } from "../lib/healthStatus.js";
import { prepare, requireSession, sendJson } from "../lib/vercelHttp.js";

// Private debug pack source. Logs are masked at write time, and the endpoint
// never triggers a live provider inference. MT5 is read-only and bounded.
export default async function handler(req, res) {
  const { clientKey, requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res
      .status(405)
      .json({ error: "Method not allowed. Use GET.", requestId });
  }

  if (!requireSession(req, res, process.env, requestId)) return;

  const rate = checkHealthRateLimit(clientKey, process.env);
  const headers = healthRateLimitHeaders(rate);
  if (!rate.allowed) {
    return sendJson(
      res,
      429,
      {
        ok: false,
        error: "Too many diagnostics requests. Try again in a minute.",
        code: "HEALTH_RATE_LIMITED",
        requestId,
      },
      headers,
    );
  }

  let limit = 50;
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const requested = Number(url.searchParams.get("limit"));
    if (Number.isFinite(requested) && requested > 0) {
      limit = Math.min(200, Math.floor(requested));
    }
  } catch {
    // Malformed URL keeps the default limit.
  }

  const report = await createDiagnosticsReport({
    env: process.env,
    requestId,
    logLimit: limit,
  });
  return sendJson(res, 200, report, headers);
}
