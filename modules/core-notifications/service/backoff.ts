// The retry schedule of a delivery (ADR 0020): 30 s after the first failed attempt, doubling,
// never more than an hour.
export const BACKOFF_BASE_SECONDS = 30;
export const BACKOFF_MAX_SECONDS = 3600;

/** Seconds to wait after attempt `attempt` (1 for the first) has failed. */
export function backoffSeconds(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  // 2 ** 20 already exceeds the cap; the clamp keeps the arithmetic finite for any input.
  return Math.min(BACKOFF_BASE_SECONDS * 2 ** Math.min(n - 1, 20), BACKOFF_MAX_SECONDS);
}
