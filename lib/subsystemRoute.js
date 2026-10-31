import { verificationHttpStatus } from "./aiProviders.js";
import { checkHealthRateLimit, healthRateLimitHeaders } from "./healthStatus.js";
import { prepare, requireSession, sendJson } from "./vercelHttp.js";

// Shared private handler for the per-subsystem health routes (Vercel adapters).
// HTTP 200 only means the probe ran; each payload's ok/status/stale fields say
// whether the subsystem actually works. AI additionally answers with the honest
// verification code so monitors cannot read a failed provider as success.
export async function handleSubsystemHealth(req, res, createReport) {
  const { clientKey, requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res
      .status(405)
      .json({ error: "Method not allowed. Use GET.", requestId });
  }

  if (!(await requireSession(req, res, process.env, requestId))) return;

  const rate = checkHealthRateLimit(clientKey, process.env);
  const headers = healthRateLimitHeaders(rate);
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
      headers,
    );
  }

  const report = await createReport();
  const statusCode =
    report.subsystem === "ai"
      ? verificationHttpStatus(report.verificationStatus)
      : report.subsystem === "storage" && !report.ok
        ? 503
        : 200;
  return sendJson(res, statusCode, { ...report, requestId }, headers);
}
