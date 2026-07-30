import { requireAuth } from "../_shared/auth.ts";
import { clientForRequest, timed } from "../_shared/db.ts";
import { errorResponse, respond } from "../_shared/errors.ts";
import { CohortCompareRequest } from "../_shared/schemas.ts";

Deno.serve(async (req) => {
  const startedAt = performance.now();
  if (req.method !== "POST") return errorResponse("bad_request", "POST only");

  const ctx = await requireAuth(req);
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return errorResponse("bad_request", "invalid JSON body");
  }
  const parsed = CohortCompareRequest.safeParse(body);
  if (!parsed.success) return errorResponse("bad_request", "validation failed", parsed.error.issues);
  const q = parsed.data;

  const sb = clientForRequest(req);
  const { result, ms: dbMs } = await timed(async () =>
    await sb.rpc("rpc_cohort_compare", {
      a_from: q.periodA.dateFrom,
      a_to: q.periodA.dateTo,
      b_from: q.periodB.dateFrom,
      b_to: q.periodB.dateTo,
      day_index_max: q.dayIndex,
      group_by: q.groupBy,
      filters: q.filters ?? {},
    })
  );
  if (result.error) return errorResponse("internal", "rpc failed", { pg: result.error.message });

  type Row = {
    key: Record<string, string>;
    a_installs: number; a_spend_usd: number | string; a_revenue_usd: number | string;
    b_installs: number; b_spend_usd: number | string; b_revenue_usd: number | string;
    significance: "ok" | "low_volume";
  };
  const rows = ((result.data ?? []) as Row[]).map((r) => {
    const a = {
      installs: Number(r.a_installs),
      spendUsd: round(Number(r.a_spend_usd), 2),
      revenueUsd: round(Number(r.a_revenue_usd), 2),
    };
    const b = {
      installs: Number(r.b_installs),
      spendUsd: round(Number(r.b_spend_usd), 2),
      revenueUsd: round(Number(r.b_revenue_usd), 2),
    };
    return {
      key: r.key,
      a, b,
      delta: {
        installs: b.installs - a.installs,
        spendUsd: round(b.spendUsd - a.spendUsd, 2),
        revenueUsd: round(b.revenueUsd - a.revenueUsd, 2),
      },
      deltaPct: {
        installs: pct(a.installs, b.installs),
        spendUsd: pct(a.spendUsd, b.spendUsd),
        revenueUsd: pct(a.revenueUsd, b.revenueUsd),
      },
      significance: r.significance,
    };
  });

  return respond(
    {
      rows,
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
function pct(a: number, b: number): number | null {
  if (a === 0) return b === 0 ? 0 : null; // undefined %; caller can render "N/A"
  return round((b - a) / a, 4);
}
