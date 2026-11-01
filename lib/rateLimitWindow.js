/**
 * One sliding window for the process-local auth, API and health limiters.
 * The hit lists themselves stay per process, so on Vercel each instance counts
 * on its own; only the window maths is shared here.
 */

export const WINDOW_MS = 60_000;

/** Hits still inside the window. An empty result means the window expired. */
export function activeWindow(times, now) {
  return (times || []).filter((time) => now - time < WINDOW_MS);
}

/**
 * Whole seconds left until the oldest hit leaves the window. Rounded up and
 * floored at 1 so Retry-After is never zero for a request that is still blocked.
 */
export function remainingSeconds(firstAttemptTime, now) {
  return Math.max(1, Math.ceil((firstAttemptTime + WINDOW_MS - now) / 1000));
}
