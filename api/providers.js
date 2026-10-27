import { getProviderStatusList } from "../lib/aiProviders.js";
import { prepare, sendJson } from "../lib/vercelHttp.js";

// Legacy endpoint kept for compatibility, without false "LIVE" claims.
export default async function handler(req, res) {
  prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const providers = getProviderStatusList(process.env);
  return sendJson(
    res,
    200,
    providers.map((item) => ({
      id: item.id,
      provider: item.provider,
      model: item.model,
      status: item.state,
      configured: item.configured,
    })),
  );
}
