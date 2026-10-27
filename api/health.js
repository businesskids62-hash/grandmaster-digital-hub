import { AGENT_REGISTRY } from "../lib/agents/registry.js";
import { parseProviders, getProviderStatusList } from "../lib/aiProviders.js";
import { taskStore } from "../lib/tasks/taskStore.js";
import { prepare, sendJson } from "../lib/vercelHttp.js";

// Public health endpoint. Never reveals secrets, environment variables or paths.
export default async function handler(req, res) {
  prepare(req, res, process.env);
  if (res.writableEnded) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const providers = parseProviders(process.env);
  const statuses = getProviderStatusList(process.env);
  const [primaryProvider, primaryModel] = (providers[0] || "").split(":");
  const storage = taskStore.status();

  return sendJson(res, 200, {
    ok: true,
    status: "online",
    timestamp: new Date().toISOString(),
    provider: primaryProvider || "gemini",
    model: primaryModel || "configured-model",
    primary: primaryModel || "configured-model",
    aiConfigured: statuses.some((item) => item.configured),
    providersCount: providers.length,
    agentsCount: AGENT_REGISTRY.length,
    storage: {
      mode: storage.mode,
      durable: storage.durable,
      ephemeral: storage.ephemeral,
      writable: storage.writable,
    },
  });
}
