# cohort-lens

Multi-tenant marketing analytics prototype. Three layers:

- Postgres with RLS as the isolation boundary
- Deno Edge Functions as the BFF
- React dashboard + an MCP server + an in-app AI chat panel on top

Built to pitch a Senior Full-Stack role at an ad-analytics SaaS. Focus is on
tenant isolation and query performance — the two things that hurt when they
break in that space. Everything else is small on purpose.

## Layout

```
supabase/
  migrations/     schema, RLS, indexes, RPCs
  seed/           deterministic seeder, ~2M cohort rows in ~15s
  functions/      BFF: cohort-performance · cohort-compare · creative-score
                       campaigns · ask (OpenRouter tool loop)
web/              React + Vite dashboard with a chat panel
mcp-server/       stdio MCP server (Claude Desktop / Cursor)
bench/            naive-vs-optimised harness + fake Meta connector
tests/            43 tests: RLS · contract · connector · mcp-client · units
demo/             SQL patches to break/restore an RLS policy on the fly
scripts/          JWT signer for MCP env
```

## What's inside

**Isolation lives in the DB.** RLS on every tenant table, one helper
(`current_user_org_ids()`) drives every policy. The BFF also validates
`X-Org-Id` against membership and returns a real `403 org_forbidden` —
better UX than a silent `200 []` if the client is confused. Both paths have
tests. `demo/break-policy.sql` widens the helper on the running DB so you
can watch the isolation suite fail live in about a second, then restore.

**Aggregation happens in SQL.** Four RPCs return already-grouped rows, FX
conversion via `JOIN fx_rates`. One covering index turns the hot query into
an index-only scan — see the plans below.

**LLM has two routes.** A stdio MCP server for Claude Desktop / Cursor, and
an in-app chat panel that calls `/ask` on the BFF (OpenRouter behind it,
default `anthropic/claude-haiku-4.5`). Both use the same four tools and the
caller's own JWT — the model never gets a privileged path.

**CI runs the real stack.** GitHub Actions boots Supabase in the runner,
seeds, starts Edge Functions, then runs typecheck + lint + tests + bench.
No mocks between them.

## Numbers

Warm run, `2026-01-01..2026-03-31`, groupBy=[channel, country], `dayIndex≤30`,
seeded `acme-games` (~655k rows on that org):

| variant                          |    p50 |    p95 | rows returned | approx bytes |
|----------------------------------|-------:|-------:|--------------:|-------------:|
| naive (SELECT + JS aggregate)    |  63 ms |  70 ms |        55,800 |     5,231 KB |
| optimised (`rpc_cohort_performance`) | 80 ms | 117 ms |            20 |       3.9 KB |

Latency looks similar on localhost — 5 MB over loopback is basically free.
Over a real VPC it isn't, and either way the plan is the interesting part.

<details>
<summary>EXPLAIN before/after (warm cache)</summary>

Before, only the baseline `(org_id, cohort_date)` index:

```
Parallel Bitmap Heap Scan on cohort_daily
  Recheck Cond: (org_id = ... AND cohort_date BETWEEN ...)
  Filter: (day_index <= 30)
  Rows Removed by Filter: 36000
Execution Time: 120 ms
```

After adding `(org_id, cohort_date, day_index) INCLUDE (…)`:

```
Parallel Index Only Scan using cohort_daily_hot_path_idx
  Index Cond: (all four columns)
  Heap Fetches: 0
Execution Time: 25 ms
```

~5× on the SQL side; `Heap Fetches: 0` is the tell. Full plans in
`bench/results/`.

</details>

## Quickstart

Prereqs: Docker, Node 20 (nvm), pnpm 10, `supabase` CLI (`npm i -g supabase`),
Deno (`curl -fsSL https://deno.land/install.sh | sh`). Full walk-through in
[SETUP.md](SETUP.md).

```bash
pnpm install
supabase start                              # ~1 min first time
pnpm db:reset && pnpm db:seed               # ~30s, ~2M rows
pnpm functions:serve                        # BFF, another shell
pnpm web:dev                                # dashboard on :5173
```

For the AI chat panel: copy `supabase/functions/.env.example` to
`supabase/functions/.env`, fill in an OpenRouter key, restart
`functions:serve`.

For the MCP server against Claude Desktop:

```bash
eval "$(node scripts/sign-mcp-jwt.mjs)"     # exports JWT + URL + ORG_ID
pnpm mcp:inspect                            # or wire the same env into Claude
```

## Decisions, said plainly

**RLS as the enforcement boundary, not app-layer filters.** App-layer
filters are a bug away from a leak — RLS runs even if the middleware
forgets. Overhead is a subquery per row and the planner folds it.

**BFF returns 403 on a cross-tenant `X-Org-Id`, not empty.** RLS alone
would give you `200 []`, which is a UX disaster to debug from the client
side. So the BFF checks membership up front. RLS still catches anything
that slips.

**No privileged key in the BFF.** Only anon + the caller's forwarded JWT.
A grep test fails CI if `service_role` shows up anywhere under
`supabase/functions/`.

**Money as `bigint` micros in the source currency.** No floats in the
source of truth. Conversion to USD happens once, in the RPC, via a JOIN to
`fx_rates`. A tiny JS helper (`microsToUsd`) exists for one-off formatting
outside the hot path.

**No ORM.** The one query that matters is a plpgsql RPC with dynamic SQL,
a covering index, and `UNIQUE NULLS NOT DISTINCT` on the natural key.
Those are things you fight ORMs to reach. A hundred lines of SQL is easier
to `EXPLAIN`.

**Aggregate in SQL, weight in TS (`score_creatives`).** SQL returns raw
per-creative components; TS applies the weighted formula. Weights can
change without a migration and the formula has unit tests.

**Cursor pagination on `/campaigns`, not offset.** Offset gets slower as
the offset grows. Cursor is O(1) via the PK index.

**`UNIQUE NULLS NOT DISTINCT` on `cohort_daily`, no surrogate PK.**
`creative_id` is nullable (campaign-level cohorts exist). Postgres 15+
lets NULL participate in a unique constraint if you say so. Simpler than
a sentinel UUID.

**`max(cohort_date)` as the anchor for `score_creatives`, not
`current_date`.** `current_date` is fine when the ETL is running, but
breaks any static dataset (demo, tests, staging clone). Anchoring to the
freshest row the caller can see tracks reality in prod and self-corrects
elsewhere. RLS keeps the `max` per-tenant.

**`VACUUM ANALYZE` at the end of the seeder.** Without it the covering
index is ignored until autovacuum catches up, and the first few
benchmark runs are meaningless. Cheap enough to just do it.

## Limits worth flagging

- Seed users are inserted with raw SQL, which means the seeder has to set
  a handful of GoTrue-required columns that a normal admin API call would
  fill in for you. The current seeder is patched but the boundary between
  "our SQL" and "Supabase's schema" is real; production would go through
  `supabase.auth.admin.createUser`.
- `pROAS` in responses is `ROAS × 1.5` — a placeholder for a real
  prediction model. Every LLM tool description and every UI cell flags it
  as a prediction. Not a shortcut I'd take for a real product.
- The Meta Ads connector in `bench/` is fake. It exists to show the shape
  of an ingest pipeline (retry with jitter, token-bucket rate limit,
  idempotent upsert on the natural key). A real one has a lot more
  edge cases.
- No SKAN / probabilistic attribution. Separate math problem, out of scope.
- No caching layer. I'd add ETag + a Redis rollup once the read patterns
  are actually known, not up-front.

## What I'd do next

1. Materialised cohort rollups, updated incrementally by an hourly job.
   Hot query becomes a range scan on already-aggregated rows.
2. ETag on `/campaigns`; Redis in front of the RPC keyed by
   `(org_id, hash(request))` with a 60s TTL, invalidated on ingest.
3. `POST /cohort-performance-export` streaming NDJSON, so a 500k-row
   export doesn't buffer in memory.
4. OAuth for MCP instead of a static JWT. Short-lived, org-scoped tokens.
5. OpenTelemetry traces. Right now `db.ms` / `total.ms` only surface via
   the `Server-Timing` header.

## Demo

[DEMO.md](DEMO.md) — three beats, ~90 seconds. Break an RLS policy live
and watch the isolation suite fail. Show the bench. Ask the in-app AI
panel "which creatives should we scale in Germany?" and watch it call
`list_campaigns` then `score_creatives`, then explain the components.

## License

MIT.
