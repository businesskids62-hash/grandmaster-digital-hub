import { handleAcademy } from "../../lib/api/academy.js";
import { prepare, requireSession, sendJson, subPathFrom } from "../../lib/vercelHttp.js";

export default async function handler(req, res) {
  const { requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  const session = await requireSession(req, res, process.env, requestId, { role: "any" });
  if (!session) return;

  const result = await handleAcademy({
    method: req.method,
    path: subPathFrom(req, "/api/academy"),
    headers: req.headers || {},
    body: req.body,
    env: process.env,
    requestId,
  });
  return sendJson(res, result.status, result.body, result.headers);
}
