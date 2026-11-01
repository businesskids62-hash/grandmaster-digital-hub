import { handleV1 } from "../../lib/api/v1.js";
import {
  prepare,
  requireSession,
  sendJson,
  queryObject,
  subPathFrom,
  isResponseClosed,
} from "../../lib/vercelHttp.js";

// Catch-all adapter for /api/v1/* on Vercel.
// Routing, validation and security live in lib/api/v1.js. This adapter adds the
// signed session check and injects the server-side control token so the shared
// control-token authorization still runs constant-time without the browser ever
// receiving the token.
export default async function handler(req, res) {
  const { requestId, clientKey } = prepare(req, res, process.env);
  if (isResponseClosed(res)) return;

  if (!(await requireSession(req, res, process.env, requestId))) return;

  const path = subPathFrom(req, "/api/v1");
  // TEMPORARY DIAGNOSTIC (removed in the next commit): reveals what the platform
  // actually hands the function after a vercel.json route rewrite.
  console.log(
    JSON.stringify({
      m009RouteProbe: true,
      url: req.url,
      method: req.method,
      resolvedPath: path,
      queryKeys: Object.keys(req.query || {}),
      headerRest: req.headers?.["x-gm-rest"] || null,
    }),
  );
  const headers = { ...(req.headers || {}), "x-request-id": requestId };
  const controlToken = String(process.env.GRANDMASTER_CONTROL_TOKEN || "");
  if (controlToken) headers["x-grandmaster-token"] = controlToken;

  const result = await handleV1({
    method: req.method,
    path,
    query: queryObject(req),
    headers,
    body: req.body,
    env: process.env,
    clientKey,
  });

  sendJson(res, result.status, result.body, result.headers);
}
