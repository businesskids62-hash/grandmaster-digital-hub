import { handleLogout } from "../../lib/auth/routes.js";
import { prepare, sendJson } from "../../lib/vercelHttp.js";

export default async function handler(req, res) {
  const { requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST.", requestId });
  }

  const result = handleLogout({ env: process.env, requestId });
  return sendJson(res, result.status, result.body, result.headers);
}
