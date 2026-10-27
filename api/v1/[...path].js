import { handleV1 } from "../../lib/api/v1.js";
import { prepare, sendJson, queryObject, isResponseClosed } from "../../lib/vercelHttp.js";

// Catch-all adapter for /api/v1/* on Vercel.
// All routing, validation and security live in lib/api/v1.js.
export default async function handler(req, res) {
  const { requestId, clientKey } = prepare(req, res, process.env);
  if (isResponseClosed(res)) return;

  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname.replace(/^\/api\/v1/, "") || "/";

  const result = await handleV1({
    method: req.method,
    path,
    query: queryObject(req),
    headers: { ...(req.headers || {}), "x-request-id": requestId },
    body: req.body,
    env: process.env,
    clientKey,
  });

  sendJson(res, result.status, result.body, result.headers);
}
