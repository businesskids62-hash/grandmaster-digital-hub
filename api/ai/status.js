import { verifyProvider } from "../../lib/aiProviders.js";
import { prepare, sendJson } from "../../lib/vercelHttp.js";

// "verified" is only returned after a real provider call succeeds.
// Key presence alone is never reported as verified.
export default async function handler(req, res) {
  prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const result = await verifyProvider(process.env, { timeoutMs: 10_000 });
  return sendJson(res, 200, {
    status: result.status,
    reason: result.reason || "",
    provider: result.provider || "gemini",
    model: result.model,
    latencyMs: result.latencyMs,
    providers: result.providers,
  });
}
