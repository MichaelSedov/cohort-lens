# DEMO — 90-second walkthrough

Assumes SETUP.md is done: supabase running, seed applied, `pnpm
functions:serve` running in one shell.

## Beat 1 — "the isolation test fails loudly when I break a policy" (~20s)

**Say:**
> "The trust boundary is the database. Watch what happens when I break
> one RLS policy and re-run the isolation suite."

**Do:**

```bash
# Widen current_user_org_ids() to return every org (the demo/break-policy.sql
# has the diff — one line).
docker exec -i supabase_db_cohort-lens psql -U postgres < demo/break-policy.sql

# The isolation suite now fails.
pnpm vitest run tests/rls.spec.ts
```

Expected: several assertions in `tests/rls.spec.ts` fail because a member
of `acme-games` now sees `northwind-apps` rows. The `403 cross-tenant
INSERT` case still passes — `WITH CHECK` on the write policy is separate
and still enforced.

**Restore:**

```bash
docker exec -i supabase_db_cohort-lens psql -U postgres < demo/restore-policy.sql
pnpm vitest run tests/rls.spec.ts     # 6 pass
```

> The git-stash version of the same change is
> [`demo/broken-policy.patch`](demo/broken-policy.patch) — apply with
> `git apply demo/broken-policy.patch` if you want the full
> reset-and-re-migrate flow.

## Beat 2 — "here is the benchmark" (~20s)

**Say:**
> "SQL aggregation with a covering index is 5× faster than the naive
> path and moves 2,790× less data. The bench asserts p95 < 250ms."

**Do:**

```bash
pnpm bench
```

Expected: the markdown table (also written to
`bench/results/bench.md`), and the last line:

```
phase-5 DoD (optimised p95 < 250ms): PASS (p95 = ~117ms)
```

Follow up by showing the EXPLAIN pair in
[README.md#benchmark](README.md#benchmark-real-numbers-from-a-warm-run-on-an-m-series-laptop) — the "before" is a
`Bitmap Heap Scan` with `Rows Removed by Filter: 36000`; the "after" is a
`Parallel Index Only Scan` with `Heap Fetches: 0`.

## Beat 3 — "here is Claude answering a real question" (~50s)

**Say:**
> "The MCP server wraps the same BFF. Claude never sees another tenant's
> data — every request forwards the caller's JWT and RLS decides what's
> visible."

**Do:**

```bash
# Mint a 12h JWT + export the MCP config.
eval "$(node scripts/sign-mcp-jwt.mjs)"
pnpm mcp:inspect
```

The MCP Inspector opens in a browser. Under **Tools**, four appear:
`list_campaigns`, `get_cohort_performance`, `compare_periods`,
`score_creatives`. Under **Resources**, the metrics glossary.

Now point Claude Desktop (or `claude mcp add`) at the server and ask:

> **"Which creatives should we scale in Germany?"**

Expected model behaviour, driven by the tool descriptions:
1. `list_campaigns` filtered to `country=DE` (the tool descriptions tell
   the model that the other tools expect uuids).
2. `score_creatives` with the returned `campaignIds`,
   `benchmarkWindowDays=30`, `dayIndex=30`.
3. Present the top few rows, with the `components` breakdown, mentioning
   that `pRoas` is a *predicted* value (the glossary + every tool's
   description flags this).

If the model tries to compute deltas by itself, `compare_periods`'s
description tells it not to — it will use the dedicated tool.

## Reset

```bash
# Kill functions:serve; stop the stack.
pkill -f "supabase functions serve"
supabase stop
```
