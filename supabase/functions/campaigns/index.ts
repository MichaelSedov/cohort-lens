import { requireAuth } from "../_shared/auth.ts";
import { clientForRequest, timed } from "../_shared/db.ts";
import { errorResponse, handleCorsPreflight, respond } from "../_shared/errors.ts";
import { CampaignsQuery } from "../_shared/schemas.ts";

/**
 * Cursor-paginated list of campaigns. The cursor is the last-seen campaign id;
 * we order by id (ascending) to make the cursor deterministic — Postgres uses
 * the PK index for that, so this stays fast even with tens of thousands of
 * campaigns per org.
 */
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const startedAt = performance.now();
  if (req.method !== "GET") return errorResponse("bad_request", "GET only");

  const ctx = await requireAuth(req);
  if (ctx instanceof Response) return ctx;

  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams);
  const parsed = CampaignsQuery.safeParse(raw);
  if (!parsed.success) return errorResponse("bad_request", "validation failed", parsed.error.issues);
  const q = parsed.data;

  const sb = clientForRequest(req);
  let query = sb
    .from("campaigns")
    .select("id, app_id, external_id, name, channel, country", { count: "exact" })
    .order("id", { ascending: true })
    .limit(q.limit + 1); // fetch one extra to detect next cursor
  if (q.cursor)  query = query.gt("id", q.cursor);
  if (q.channel) query = query.eq("channel", q.channel);
  if (q.country) query = query.eq("country", q.country);

  const { result, ms: dbMs } = await timed(async () => await query);
  if (result.error) return errorResponse("internal", "list failed", { pg: result.error.message });

  const rows = result.data ?? [];
  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.id : null;

  return respond(
    {
      items,
      pagination: { nextCursor, hasMore, limit: q.limit },
      meta: { rowCount: result.count ?? null, timezone: ctx.orgTimezone, queryMs: dbMs },
    },
    { startedAt, dbMs },
  );
});
