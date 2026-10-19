/**
 * Grandmaster AI Service Adapter
 * Pluggable multi-provider backend service adapter.
 * Handles request timeouts, rate limits, input validation, and credential isolation.
 */

const SYSTEM_INSTRUCTION = `You are the Grandmaster AI, the core intelligence and digital architect of the Grandmaster Digital Hub (Learn, Build, Earn).
Your role is to guide and empower learners, coders, and young digital entrepreneurs.
You can communicate effectively in English and Roman Urdu (and Urdu script when requested).
Be encouraging, intellectually rigorous, practical, and clear.
Provide code snippets, project roadmaps, and business advice when requested.`;

export async function generateAiReply({
  message,
  history = [],
  provider = "gemini",
  model = "gemini-3.8-flash",
  apiKey,
}) {
  // Input validation
  if (!message || typeof message !== "string" || !message.trim()) {
    const error = new Error("Message content cannot be empty.");
    error.status = 400;
    error.code = "INVALID_INPUT";
    throw error;
  }

  // Validate API Key presence
  if (
    !apiKey ||
    typeof apiKey !== "string" ||
    apiKey.trim() === "" ||
    apiKey.trim() === "your_gemini_api_key_here"
  ) {
    const error = new Error(
      "Google Gemini API key is not configured on the backend server. Please set GEMINI_API_KEY in the server .env file.",
    );
    error.status = 503;
    error.code = "AI_CONFIG_MISSING";
    throw error;
  }

  const selectedProvider = (provider || "gemini").toLowerCase();

  if (selectedProvider === "gemini") {
    return await callGeminiProvider({
      message: message.trim(),
      history,
      model,
      apiKey: apiKey.trim(),
    });
  }

  const error = new Error(
    `Unsupported AI provider: "${provider}". Configured providers: ["gemini"].`,
  );
  error.status = 400;
  error.code = "UNSUPPORTED_PROVIDER";
  throw error;
}

/**
 * Google Gemini REST Provider Implementation
 */
async function callGeminiProvider({ message, history, model, apiKey }) {
  const targetModel = model || "gemini-3.8-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Construct conversation contents for Gemini
  const contents = [];

  // Map previous history (limit to last 10 turns to avoid excessive context)
  const recentHistory = Array.isArray(history) ? history.slice(-10) : [];
  for (const entry of recentHistory) {
    if (entry && entry.content && typeof entry.content === "string") {
      const role = entry.role === "user" ? "user" : "model";
      contents.push({
        role,
        parts: [{ text: entry.content }],
      });
    }
  }

  // Append latest user message
  contents.push({
    role: "user",
    parts: [{ text: message }],
  });

  const requestBody = {
    contents,
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  // 30-second request timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorDetail = "";
      try {
        const errorJson = await response.json();
        errorDetail = errorJson.error?.message || response.statusText;
      } catch {
        errorDetail = response.statusText;
      }

      // Debug log: shows the real Gemini error in the node terminal
      console.error("[Gemini ERROR]", response.status, errorDetail);

      if (
        response.status === 400 &&
        errorDetail.toLowerCase().includes("api_key")
      ) {
        const err = new Error(
          "The configured GEMINI_API_KEY is invalid or expired. Please check your credentials in .env.",
        );
        err.status = 401;
        err.code = "INVALID_API_KEY";
        throw err;
      }

      if (response.status === 429) {
        const err = new Error(
          "Gemini API rate limit exceeded. Please wait a moment before sending another message.",
        );
        err.status = 429;
        err.code = "RATE_LIMIT_EXCEEDED";
        throw err;
      }

      const err = new Error(
        `Google Gemini API error (${response.status}): ${errorDetail}`,
      );
      err.status = response.status;
      err.code = "PROVIDER_ERROR";
      throw err;
    }

    const data = await response.json();

    // Validate response payload
    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content?.parts?.[0]?.text) {
      if (candidate?.finishReason === "SAFETY") {
        const err = new Error(
          "The response was blocked by Gemini safety filters.",
        );
        err.status = 422;
        err.code = "CONTENT_FILTERED";
        throw err;
      }
      const err = new Error(
        "Gemini returned an empty or unparseable response.",
      );
      err.status = 502;
      err.code = "EMPTY_RESPONSE";
      throw err;
    }

    const replyText = candidate.content.parts[0].text;

    return {
      reply: replyText,
      provider: "gemini",
      model: targetModel,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === "AbortError") {
      const timeoutErr = new Error(
        "The request to Google Gemini timed out after 30 seconds.",
      );
      timeoutErr.status = 504;
      timeoutErr.code = "TIMEOUT";
      throw timeoutErr;
    }

    throw error;
  }
}
