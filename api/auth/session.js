import { handleSession } from "../../lib/auth/routes.js";
import { prepare, sendJson } from "../../lib/vercelHttp.js";

export default async function handler(req, res) {
  const { requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET.", requestId });
  }

  const result = await handleSession({ headers: req.headers || {}, env: process.env, requestId });
  return sendJson(res, result.status, result.body, result.headers);
}
