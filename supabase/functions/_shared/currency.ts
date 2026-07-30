// Money helpers. All storage is bigint micros in the source currency; USD
// conversion happens exactly once via this function or the equivalent JOIN in
// an RPC (see 0005_rpc_functions.sql). Kept pure so Vitest can unit-test it
// without any Deno-specific imports.

/**
 * Convert `micros` (bigint or number) in a currency with fx rate `rateToUsd`
 * into USD, returned as a JS number rounded to 4 decimal places (~$0.0001).
 *
 * Contract:
 *   - rateToUsd must be > 0 (throws otherwise).
 *   - micros must be >= 0 (throws otherwise).
 *   - `microsToUsd(0, r)` === 0.
 */
export function microsToUsd(micros: bigint | number, rateToUsd: number): number {
  if (rateToUsd <= 0 || !Number.isFinite(rateToUsd)) {
    throw new Error(`microsToUsd: rateToUsd must be > 0, got ${rateToUsd}`);
  }
  const n = typeof micros === "bigint" ? Number(micros) : micros;
  if (n < 0 || !Number.isFinite(n)) {
    throw new Error(`microsToUsd: micros must be >= 0, got ${n}`);
  }
  return Math.round((n / 1_000_000) * rateToUsd * 10_000) / 10_000;
}
