/**
 * One sliding window shared by the two chat limiters: the Express server route
 * and the Vercel chat function. Only the window maths and the bounded
 * bookkeeping live here — the hit lists stay per process, so on Vercel each
 * instance still counts on its own (distributed limiting is not solved).
 */

import { activeWindow, remainingSeconds, WINDOW_MS } from "./rateLimitWindow.js";

const DEFAULT_MAX_REQUESTS = 10;

/**
 * Ceiling on concurrently tracked clients. Reaching it sweeps the buckets whose
 * window already expired and then evicts the least recently inserted ones, so
 * one noisy client can no longer wipe every other client's state the way a
 * blanket `Map.clear()` did.
 */
export const MAX_CHAT_CLIENTS = 1000;

/**
 * Creates an isolated limiter. Each caller owns its own hit map, which keeps the
 * Express app instance-scoped exactly as before.
 *
 * `env` and `now` are parameters rather than globals so tests can drive the
 * window with a fake clock, matching `checkAuthRateLimit` and
 * `checkHealthRateLimit`.
 */
export function createChatRateLimiter() {
  const hits = new Map();

  function sweepExpired(now) {
    for (const [key, times] of hits) {
      const last = times[times.length - 1] || 0;
      if (now - last >= WINDOW_MS) hits.delete(key);
    }
    while (hits.size >= MAX_CHAT_CLIENTS) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
  }

  function check(clientKey = "unknown", env = process.env, now = Date.now()) {
    const configured =
      Number(env?.AI_RATE_LIMIT_PER_MINUTE) ||
      Number(env?.RATE_LIMIT_PER_MINUTE) ||
      DEFAULT_MAX_REQUESTS;
    const limit = Math.max(1, Math.floor(configured));
    const key = String(clientKey || "unknown").slice(0, 120);

    if (hits.size >= MAX_CHAT_CLIENTS) sweepExpired(now);

    const stored = hits.get(key);
    const recent = activeWindow(stored, now);
    // A client whose window fully lapsed stops occupying a slot at all.
    if (stored && recent.length === 0) hits.delete(key);

    if (recent.length >= limit) {
      hits.set(key, recent);
      return { allowed: false, limit, retryAfter: remainingSeconds(recent[0], now) };
    }

    recent.push(now);
    hits.set(key, recent);
    return { allowed: true, limit, retryAfter: 0 };
  }

  return { check, tracked: () => hits.size };
}
