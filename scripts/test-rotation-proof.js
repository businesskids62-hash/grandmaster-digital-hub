// scripts/test-rotation-proof.js
import { executeProviderRotation, resetBreakerState } from "../lib/aiProviders.js";

async function runProof() {
  resetBreakerState();
  console.log("=== FORCED 429 FALLBACK PROOF ===");

  const fakeEnv = {
    AI_PROVIDERS: "gemini:gemini-2.5-flash,gemini:gemini-2.5-pro",
    GEMINI_API_KEY: "forced-test-key-safe",
  };

  const mockFetch = async (url) => {
    if (url.includes("gemini-2.5-flash")) {
      console.log(`[Mock Network] POST -> gemini-2.5-flash returning HTTP 429 (Rate Limit Exceeded) Retry-After: 45`);
      return {
        ok: false,
        status: 429,
        headers: new Map([["retry-after", "45"]]),
        json: async () => ({ error: { message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per minute'" } }),
      };
    }
    if (url.includes("gemini-2.5-pro")) {
      console.log(`[Mock Network] POST -> gemini-2.5-pro returning HTTP 200 (Success fallback)`);
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Hello! Grandmaster AI successfully responded via gemini-2.5-pro fallback." }] } }],
        }),
      };
    }
    throw new Error("Unexpected URL: " + url);
  };

  const result = await executeProviderRotation({
    message: "Test fallback query",
    env: fakeEnv,
    fetchImpl: mockFetch,
  });

  console.log("\n--- RESULT ---");
  console.log("Resolved Provider:", result.provider);
  console.log("Resolved Model:", result.model);
  console.log("Reply:", result.reply);
  console.log("Attempts Log:", JSON.stringify(result.attempts, null, 2));
}

runProof().catch(console.error);
