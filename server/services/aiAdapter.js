// server/services/aiAdapter.js
// Backward-compatible adapter forwarding to centralized lib/aiProviders.js

import {
  executeProviderRotation,
  getProviderStatusList,
  parseProviders,
  AIProviderError,
} from "../../lib/aiProviders.js";

export class AIError extends AIProviderError {}

export function getAIConfig(env = process.env) {
  const providers = parseProviders(env);
  const primary = providers[0] || { provider: "gemini", model: "gemini-3.6-flash" };
  const statuses = getProviderStatusList(env);
  const isConfigured = statuses.some((s) => s.configured);

  return {
    provider: primary.provider,
    model: primary.model,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    configured: isConfigured,
    problem: isConfigured ? "" : "API key is not configured.",
  };
}

export async function generateReply(
  { message, history = [] },
  env = process.env,
) {
  const result = await executeProviderRotation({
    message,
    history,
    env,
  });
  return result.reply;
}
