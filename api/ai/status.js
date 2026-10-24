import { getProviderStatusList, PROVIDER_DEFAULTS } from "../../lib/aiProviders.js";
import { applyCors } from "../../lib/cors.js";

export const config = {
  maxDuration: 15,
};

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const providers = getProviderStatusList(process.env);
  const primary = providers[0];

  if (!primary || !primary.configured) {
    return res.status(200).json({
      status: "failed",
      reason: "API key is not configured in environment.",
      model: primary?.model || "unknown",
      providers,
    });
  }

  const key = (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || "").trim();
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  let reply = "";
  try {
    const url = `${PROVIDER_DEFAULTS.gemini.baseUrl}/models/${encodeURIComponent(primary.model)}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
        generationConfig: { maxOutputTokens: 256 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      try {
        const data = await response.json();
        reply = (data?.candidates?.[0]?.content?.parts || [])
          .map((p) => p?.text || "")
          .join("");
      } catch {}
      if (reply.trim()) {
        return res.status(200).json({
          status: "verified",
          reason: "",
          model: primary.model,
          latencyMs: Date.now() - started,
          providers,
        });
      }
    }

    let detail = "";
    try {
      if (!response.ok) {
        detail = (await response.json())?.error?.message || "";
      }
    } catch {}

    const emptyReply = response.ok && !reply.trim();

    const reason = emptyReply
      ? "Gemini returned an empty response."
      : response.status === 400 || response.status === 403
      ? `Invalid API key or key not allowed for this model (HTTP ${response.status}).`
      : response.status === 404
      ? `Model "${primary.model}" not found for this key.`
      : response.status === 429
      ? "Gemini quota/rate limit reached."
      : `Gemini returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`;

    return res.status(200).json({
      status: "failed",
      reason,
      model: primary.model,
      providers,
    });
  } catch (error) {
    clearTimeout(timer);
    const reason =
      error.name === "AbortError"
        ? "Request to Gemini timed out after 10s."
        : `Gemini unreachable: ${error.message}`;

    return res.status(200).json({
      status: "failed",
      reason,
      model: primary.model,
      providers,
    });
  }
}

