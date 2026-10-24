import { getProviderStatusList } from "../../lib/aiProviders.js";
import { applyCors } from "../../lib/cors.js";

export const config = {
  maxDuration: 15,
};

export default function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const providers = getProviderStatusList(process.env);
  return res.status(200).json({
    providers,
    timestamp: new Date().toISOString(),
  });
}
