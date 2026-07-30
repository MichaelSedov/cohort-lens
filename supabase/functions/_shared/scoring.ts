// Creative-score composition. The SQL side (rpc_creative_score) returns the
// raw components (pROAS, retention proxy, CPI, spend); this module applies the
// explicit weights and normalisations so the formula is easy to unit-test and
// easy to change without touching SQL.
//
// The score is 0..100. Individual components are normalised against the
// benchmark rows the RPC returned so the score is "vs. the peer set", not
// against an arbitrary hardcoded scale.

export type ScoreInput = {
  installs: number;
  spendUsd: number;
  d0RevenueUsd: number;
  d7RevenueUsd: number;
  pRoas: number;      // revenue / spend at the horizon
  cpiUsd: number;     // spend / installs
};

export type Benchmark = {
  pRoasMedian: number;
  pRoasMax: number;
  cpiMedian: number;
  cpiMax: number;    // for clamping
  spendMax: number;  // max spend across the benchmark set
};

export type ScoreBreakdown = {
  score: number;             // 0..100
  components: {
    pRoas:     { value: number; weight: 0.45; contribution: number };
    retention: { value: number; weight: 0.20; contribution: number }; // D7/D0 revenue ratio
    cpi:       { value: number; weight: 0.20; contribution: number }; // higher is better (below median good)
    spend:     { value: number; weight: 0.15; contribution: number }; // confidence factor
  };
};

const W_PROAS = 0.45;
const W_RET   = 0.20;
const W_CPI   = 0.20;
const W_SPEND = 0.15;

/**
 * Clamp x to [0, 1] then scale into [0, 100].
 */
function scale100(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x)) * 100;
}

export function scoreCreative(input: ScoreInput, bench: Benchmark): ScoreBreakdown {
  // pROAS: normalise against benchmark median. 1.0 == "at the median" == 50/100.
  // Above the max is capped at 1.0 (100/100 for this component).
  const pRoasNorm = bench.pRoasMax > 0 ? input.pRoas / bench.pRoasMax : 0;
  const pRoasComp = scale100(pRoasNorm);

  // Retention proxy: D7 revenue / D0 revenue. Zero-D0-revenue creatives get 0
  // for this component (rather than NaN); note that in our data D0 revenue is
  // usually 0 for install-day cohorts, so this ratio is inherently noisy — it's
  // included as a weak signal, not a strong one.
  const retentionRatio = input.d0RevenueUsd > 0 ? input.d7RevenueUsd / input.d0RevenueUsd : 0;
  // A ratio of >= 3 counts as "great retention" -> full component score.
  const retentionComp = scale100(retentionRatio / 3);

  // CPI: lower is better. Below-median CPI is rewarded; above the max is 0.
  // A creative with 0 installs (undefined CPI) contributes 0 here.
  let cpiComp = 0;
  if (input.installs > 0 && bench.cpiMedian > 0 && bench.cpiMax > 0) {
    // Linear: cpi=median -> 0.5, cpi=0 -> 1.0, cpi=cpiMax -> 0.
    const fraction = 1 - input.cpiUsd / bench.cpiMax;
    cpiComp = scale100(fraction);
  }

  // Spend confidence: sqrt scale so a small budget still contributes something
  // but a spend-heavy creative dominates. Max spend -> 100.
  const spendComp = bench.spendMax > 0
    ? scale100(Math.sqrt(input.spendUsd / bench.spendMax))
    : 0;

  const score =
    pRoasComp * W_PROAS +
    retentionComp * W_RET +
    cpiComp * W_CPI +
    spendComp * W_SPEND;

  return {
    score: Math.round(score * 100) / 100,
    components: {
      pRoas:     { value: input.pRoas,       weight: W_PROAS, contribution: pRoasComp * W_PROAS },
      retention: { value: retentionRatio,    weight: W_RET,   contribution: retentionComp * W_RET },
      cpi:       { value: input.cpiUsd,      weight: W_CPI,   contribution: cpiComp * W_CPI },
      spend:     { value: input.spendUsd,    weight: W_SPEND, contribution: spendComp * W_SPEND },
    },
  };
}

/** Derive a benchmark object from a set of raw component rows. */
export function benchmarkFromRows(rows: ScoreInput[]): Benchmark {
  if (rows.length === 0) {
    return { pRoasMedian: 0, pRoasMax: 0, cpiMedian: 0, cpiMax: 0, spendMax: 0 };
  }
  const pRoas = rows.map((r) => r.pRoas).sort((a, b) => a - b);
  const cpiRows = rows.filter((r) => r.installs > 0);
  const cpi = cpiRows.map((r) => r.cpiUsd).sort((a, b) => a - b);
  const spend = rows.map((r) => r.spendUsd);
  return {
    pRoasMedian: pRoas[Math.floor(pRoas.length / 2)] ?? 0,
    pRoasMax:    pRoas[pRoas.length - 1] ?? 0,
    cpiMedian:   cpi[Math.floor(cpi.length / 2)] ?? 0,
    cpiMax:      cpi[cpi.length - 1] ?? 0,
    spendMax:    Math.max(0, ...spend),
  };
}
