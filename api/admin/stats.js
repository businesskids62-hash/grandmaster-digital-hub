import { handleAdminStats } from "../../lib/admin/stats.js";
import { prepare, requireSession, sendJson } from "../../lib/vercelHttp.js";

export default async function handler(req, res) {
  const { requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  const session = await requireSession(req, res, process.env, requestId);
  if (!session) return;

  const result = await handleAdminStats({
    method: req.method,
    headers: req.headers || {},
    env: process.env,
    requestId,
  });
  return sendJson(res, result.status, result.body, result.headers);
}
