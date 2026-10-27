import { getProviderStatusList, parseProviders } from "../lib/aiProviders.js";
import { prepare, sendJson } from "../lib/vercelHttp.js";

// Legacy endpoint kept for compatibility.
// It reports configuration only; it never claims the backend or AI is verified.
export default async function handler(req, res) {
  prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const statuses = getProviderStatusList(process.env);
  const [provider, model] = (parseProviders(process.env)[0] || "").split(":");
  const configured = statuses.some((item) => item.configured);

  return sendJson(res, configured ? 200 : 503, {
    ok: configured,
    backend: "reachable",
    provider: provider || "gemini",
    model: model || "configured-model",
    configured,
    aiVerified: false,
    reason: configured
      ? "The key is configured. Call /api/ai/status for real verification."
      : "GEMINI_API_KEY is not configured on the server.",
  });
}
