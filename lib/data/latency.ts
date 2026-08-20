/** Simulated network latency so loading skeletons are exercised for real.
 *  Set MOCK_LATENCY_MS to 0 to disable while developing. */

export const MOCK_LATENCY_MS = 350;

export function simulateLatency(ms: number = MOCK_LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
