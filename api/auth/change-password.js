import { handleChangePassword } from "../../lib/auth/routes.js";
import { prepare, sendJson } from "../../lib/vercelHttp.js";

function parsedBody(body) {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const { requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  const result = handleChangePassword({
    method: req.method,
    headers: req.headers || {},
    body: parsedBody(req.body),
    env: process.env,
    requestId,
  });
  return sendJson(res, result.status, result.body, result.headers);
}
