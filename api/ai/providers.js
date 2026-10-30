import {
  getProviderStatusList,
  getVerificationSnapshot,
  providerHealthLabel,
} from "../../lib/aiProviders.js";
import { prepare, requireSession, sendJson } from "../../lib/vercelHttp.js";

export default async function handler(req, res) {
  const { requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET.", requestId });
  }

  if (!(await requireSession(req, res, process.env, requestId))) return;

  const snapshot = getVerificationSnapshot();
  return sendJson(res, 200, {
    providers: getProviderStatusList(process.env).map((item) => ({
      ...item,
      health: providerHealthLabel(item, snapshot),
    })),
    timestamp: new Date().toISOString(),
  });
}
