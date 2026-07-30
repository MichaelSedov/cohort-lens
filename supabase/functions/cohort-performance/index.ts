import { requireAuth } from "../_shared/auth.ts";
import { clientForRequest, timed } from "../_shared/db.ts";
import { errorResponse, respond } from "../_shared/errors.ts";
import { CohortPerformanceRequest } from "../_shared/schemas.ts";

Deno.serve(async (req) => {
  const startedAt = performance.now();
  if (req.method !== "POST") return errorResponse("bad_request", "POST only");

  const ctx = await requireAuth(req);
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return errorResponse("bad_request", "invalid JSON body");
  }
  const parsed = CohortPerformanceRequest.safeParse(body);
  if (!parsed.success) return errorResponse("bad_request", "validation failed", parsed.error.issues);
  const q = parsed.data;

  const sb = clientForRequest(req);
  const { result, ms: dbMs } = await timed(async () =>
    await sb.rpc("rpc_cohort_performance", {
      date_from: q.dateFrom,
      date_to: q.dateTo,
      day_index_max: q.dayIndex,
      group_by: q.groupBy,
      filters: q.filters ?? {},
      sort_field: q.sort.field,
      sort_dir: q.sort.dir,
      page_limit: q.page.limit,
      page_offset: q.page.offset,
    })
  );

  if (result.error) {
    return errorResponse("internal", "rpc failed", { pg: result.error.message });
  }
  type Row = {
    key: Record<string, string>;
    installs: number;
    spend_usd: number | string;
    revenue_usd: number | string;
    row_count: number | string;
  };
  const rows = (result.data ?? []) as Row[];

  const respRows = rows.map((r) => {
    const spendUsd = Number(r.spend_usd);
    const revenueUsd = Number(r.revenue_usd);
    const roas = spendUsd === 0 ? 0 : round(revenueUsd / spendUsd, 4);
    // pROAS: naive prediction = ROAS × time-decay multiplier. Documented in the
    // MCP tool description as "prediction, not actual". Real model would live
    // in a separate ML pipeline; this keeps the API contract stable.
    const pRoas = round(roas * 1.5, 4);
    const cpi = r.installs === 0 ? 0 : round(spendUsd / Number(r.installs), 4);
    return {
      key: r.key,
      installs: Number(r.installs),
      spendUsd: round(spendUsd, 2),
      revenueUsd: round(revenueUsd, 2),
      roas,
      pRoas,
      cpi,
    };
  });

  const totals = respRows.reduce(
    (t, r) => ({
      installs: t.installs + r.installs,
      spendUsd: t.spendUsd + r.spendUsd,
      revenueUsd: t.revenueUsd + r.revenueUsd,
    }),
    { installs: 0, spendUsd: 0, revenueUsd: 0 },
  );
  const totalsResp = {
    installs: totals.installs,
    spendUsd: round(totals.spendUsd, 2),
    revenueUsd: round(totals.revenueUsd, 2),
    roas: totals.spendUsd === 0 ? 0 : round(totals.revenueUsd / totals.spendUsd, 4),
  };

  return respond(
    {
      rows: respRows,
      totals: totalsResp,
      meta: {
        rowCount: Number(rows[0]?.row_count ?? 0),
        timezone: ctx.orgTimezone,
        currency: "USD",
        queryMs: dbMs,
        cached: false,
      },
    },
    { startedAt, dbMs },
  );
});

function round(x: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}
