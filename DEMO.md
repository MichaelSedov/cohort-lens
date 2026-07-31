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

## Beat 3 — "here is the model answering a real question" (~50s)

**Say:**
> "The dashboard has an in-app AI panel that calls the same BFF via
> OpenRouter. Same auth path as everything else — the model never sees
> another tenant's data, RLS decides for it."

**Do:**

1. Open `http://localhost:5173`, log in as `analyst @ acme-games`.
2. In the AI panel at the top, click the suggestion **"Which creatives should we scale in Germany?"** (or type your own).

Expected: two tool pills fire — `list_campaigns(country="DE")` and
`score_creatives(...)`. Then a markdown table appears with creative names,
scores, and component breakdown. Click a green pill to expand the raw
tool result — that's the ground truth the model reasoned from.

Follow-ups you can ask on the same screen:
- *"How did meta perform in April vs March?"* — triggers `compare_periods`.
- *"Any spend anomaly recently?"* — usually hits `get_cohort_performance`
  and spots the seeded 5× spike on `2026-04-01`.

**MCP path (alternative — for a technical audience):** same tools, external
client:

```bash
eval "$(node scripts/sign-mcp-jwt.mjs)"
pnpm mcp:inspect                       # or wire into Claude Desktop
```

Point Claude Desktop at the same env and ask the same question. Same
routing, same auth, same isolation — different transport.

## Reset

```bash
# Kill functions:serve; stop the stack.
pkill -f "supabase functions serve"
supabase stop
```
