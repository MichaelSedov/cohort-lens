import { requireAuth } from "../_shared/auth.ts";
import { clientForRequest, timed } from "../_shared/db.ts";
import { errorResponse, respond } from "../_shared/errors.ts";
import { CreativeScoreRequest } from "../_shared/schemas.ts";
import { benchmarkFromRows, scoreCreative, type ScoreInput } from "../_shared/scoring.ts";

Deno.serve(async (req) => {
  const startedAt = performance.now();
  if (req.method !== "POST") return errorResponse("bad_request", "POST only");

  const ctx = await requireAuth(req);
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return errorResponse("bad_request", "invalid JSON body");
  }
  const parsed = CreativeScoreRequest.safeParse(body);
  if (!parsed.success) return errorResponse("bad_request", "validation failed", parsed.error.issues);
  const q = parsed.data;

  const sb = clientForRequest(req);
  const { result, ms: dbMs } = await timed(async () =>
    await sb.rpc("rpc_creative_score", {
      campaign_ids: q.campaignIds ?? null,
      creative_ids: q.creativeIds ?? null,
      day_index_horizon: q.dayIndex,
      benchmark_window_days: q.benchmarkWindowDays,
    })
  );
  if (result.error) return errorResponse("internal", "rpc failed", { pg: result.error.message });

  type Row = {
    creative_id: string;
    campaign_id: string;
    installs: number | string;
    spend_usd: number | string;
    revenue_usd_horizon: number | string;
    d0_revenue_usd: number | string;
    d7_revenue_usd: number | string;
    cpi_usd: number | string;
    p_roas: number | string;
  };
  const rawRows = (result.data ?? []) as Row[];

  const scoreInputs: ScoreInput[] = rawRows.map((r) => ({
    installs:     Number(r.installs),
    spendUsd:     Number(r.spend_usd),
    d0RevenueUsd: Number(r.d0_revenue_usd),
    d7RevenueUsd: Number(r.d7_revenue_usd),
    pRoas:        Number(r.p_roas),
    cpiUsd:       Number(r.cpi_usd),
  }));

  // Benchmarks are computed from the current window (never hardcoded) — spec.
  const bench = benchmarkFromRows(scoreInputs);

  const rows = rawRows.map((r, i) => {
    const input = scoreInputs[i]!;
    const scored = scoreCreative(input, bench);
    return {
      creativeId: r.creative_id,
      campaignId: r.campaign_id,
      installs: input.installs,
      spendUsd: round(input.spendUsd, 2),
      pRoas: round(input.pRoas, 4),
      cpiUsd: round(input.cpiUsd, 4),
      score: scored.score,
      components: scored.components,
    };
  });
  rows.sort((a, b) => b.score - a.score);

  return respond(
    {
      rows,
      benchmark: {
        window: `${q.benchmarkWindowDays}d`,
        pRoasMedian: round(bench.pRoasMedian, 4),
        pRoasMax:    round(bench.pRoasMax, 4),
        cpiMedian:   round(bench.cpiMedian, 4),
        cpiMax:      round(bench.cpiMax, 4),
        spendMax:    round(bench.spendMax, 2),
      },
      meta: {
        rowCount: rows.length,
        timezone: ctx.orgTimezone,
        currency: "USD",
        queryMs: dbMs,
      },
    },
    { startedAt, dbMs },
  );
});

function round(x: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}
