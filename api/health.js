import { parseProviders, getProviderStatusList } from "../lib/aiProviders.js";
import { applyCors } from "../lib/cors.js";

export const config = {
  maxDuration: 15,
};

export default function handler(req, res) {
  if (applyCors(req, res)) return;

  const providers = parseProviders(process.env);
  const statuses = getProviderStatusList(process.env);
  const primary = providers[0] || { provider: "gemini", model: "gemini-3.6-flash" };
  const hasConfigured = statuses.some((s) => s.configured);

  res.status(200).json({
    ok: true,
    uptime: Math.round(process.uptime ? process.uptime() : 0),
    timestamp: new Date().toISOString(),
    provider: primary.provider,
    model: primary.model,
    aiConfigured: hasConfigured,
    providersCount: providers.length,
  });
}
