import { handleHealthEndpoint } from "../../lib/vercel/endpoints.js";

// Catch-all adapter for /api/health/* on Vercel (ai, mt5, storage, readiness).
// /api/health itself stays in api/health.js. These probes are private and
// session-guarded; behaviour lives in lib/subsystemRoute.js and
// lib/healthStatus.js.
export default async function handler(req, res) {
  return handleHealthEndpoint(req, res);
}
