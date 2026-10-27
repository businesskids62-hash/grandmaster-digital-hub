import { getProviderStatusList } from "../../lib/aiProviders.js";
import { prepare, sendJson } from "../../lib/vercelHttp.js";

export default async function handler(req, res) {
  prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  return sendJson(res, 200, {
    providers: getProviderStatusList(process.env),
    timestamp: new Date().toISOString(),
  });
}
