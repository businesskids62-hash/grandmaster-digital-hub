import { refreshProviderVerification } from "../../lib/aiProviders.js";
import { prepare, queryObject, requireSession, sendJson } from "../../lib/vercelHttp.js";

// "verified" is only returned after a real provider call succeeds.
// Key presence alone is never reported as verified.
export default async function handler(req, res) {
  const { requestId } = prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET.", requestId });
  }

  if (!(await requireSession(req, res, process.env, requestId))) return;

  const query = queryObject(req);
  const force = query.force === "1" || query.force === "true" || query.force === "yes";
  const payload = await refreshProviderVerification(process.env, { force });
  return sendJson(res, 200, { ...payload, requestId });
}
