import { describe, expect, it } from "vitest";
import {
  benchmarkFromRows,
  scoreCreative,
  type ScoreInput,
} from "../../supabase/functions/_shared/scoring.ts";

const baseRow: ScoreInput = {
  installs: 500,
  spendUsd: 2000,
  d0RevenueUsd: 100,
  d7RevenueUsd: 300,
  pRoas: 1.2,
  cpiUsd: 4,
};

describe("scoreCreative", () => {
  it("weights sum to 1.0 across components", () => {
    const { components } = scoreCreative(baseRow, benchmarkFromRows([baseRow]));
    const total = components.pRoas.weight + components.retention.weight + components.cpi.weight + components.spend.weight;
    expect(total).toBe(1);
  });

  it("returns a finite score in [0, 100] for a normal creative", () => {
    const s = scoreCreative(baseRow, benchmarkFromRows([baseRow, { ...baseRow, pRoas: 0.6 }]));
    expect(Number.isFinite(s.score)).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
  });

  it("zero installs: cpi component contributes 0 (no NaN)", () => {
    const row: ScoreInput = { ...baseRow, installs: 0, cpiUsd: 0 };
    const s = scoreCreative(row, benchmarkFromRows([baseRow, row]));
    expect(s.components.cpi.contribution).toBe(0);
    expect(Number.isFinite(s.score)).toBe(true);
  });

  it("zero spend: pRoas and spend components contribute 0, retention still counts", () => {
    const row: ScoreInput = { ...baseRow, spendUsd: 0, pRoas: 0 };
    const s = scoreCreative(row, benchmarkFromRows([baseRow, row]));
    expect(s.components.spend.contribution).toBe(0);
    expect(s.components.pRoas.contribution).toBe(0);
    expect(Number.isFinite(s.score)).toBe(true);
  });

  it("higher pROAS -> higher score, everything else equal", () => {
    const rows = [baseRow, { ...baseRow, pRoas: 3.0 }];
    const bench = benchmarkFromRows(rows);
    const lo = scoreCreative(rows[0], bench).score;
    const hi = scoreCreative(rows[1], bench).score;
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("benchmarkFromRows", () => {
  it("returns zeros for an empty benchmark set (no divide-by-zero downstream)", () => {
    const b = benchmarkFromRows([]);
    expect(b.pRoasMax).toBe(0);
    expect(b.cpiMax).toBe(0);
    expect(b.spendMax).toBe(0);
  });
});
