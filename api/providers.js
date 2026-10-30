import {
  getProviderStatusList,
  getVerificationSnapshot,
  providerHealthLabel,
} from "../lib/aiProviders.js";
import { prepare, requireSession, sendJson } from "../lib/vercelHttp.js";

// Legacy endpoint kept for compatibility, without false "LIVE" claims.
export default async function handler(req, res) {
  const { requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET.", requestId });
  }

  if (!(await requireSession(req, res, process.env, requestId))) return;

  const providers = getProviderStatusList(process.env);
  const snapshot = getVerificationSnapshot();
  return sendJson(
    res,
    200,
    providers.map((item) => ({
      id: item.id,
      provider: item.provider,
      model: item.model,
      status: providerHealthLabel(item, snapshot),
      state: item.state,
      configured: item.configured,
    })),
  );
}
