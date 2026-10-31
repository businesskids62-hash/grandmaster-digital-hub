import { handleAiEndpoint } from "../../lib/vercel/endpoints.js";

// Catch-all adapter for /api/ai/* on Vercel (providers, status). Behaviour and
// the honest verification labels live in lib/aiProviders.js.
export default async function handler(req, res) {
  return handleAiEndpoint(req, res);
}
