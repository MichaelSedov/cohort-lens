# cohort-lens

**Live demo:** [cohort-lens-web-beta.vercel.app](https://cohort-lens-web-beta.vercel.app/) — login with any seed user (password: `password`).

Multi-tenant marketing analytics slice. Three layers:

- Postgres with RLS as the isolation boundary
- Deno Edge Functions as the BFF
- React dashboard + MCP server + in-app AI chat panel on top

Scope is deliberately narrow: cohort-based ROAS / pROAS / creative scoring
across a few seeded tenants. The two things it actually invests in are
tenant isolation and hot-query performance.

## Layout

```
supabase/
  migrations/     schema, RLS, indexes, RPCs
  seed/           deterministic seeder, ~400k cohort rows in ~4s
  functions/      BFF: cohort-performance · cohort-compare · creative-score
                       campaigns · ask (OpenRouter tool loop)
web/              React + Vite dashboard with a chat panel
mcp-server/       stdio MCP server (Claude Desktop / Cursor)
bench/            naive-vs-optimised harness + fake Meta connector
tests/            43 tests: RLS · contract · connector · mcp-client · units
scripts/          JWT signer for MCP env
```

## What's inside

**Isolation lives in the DB.** RLS on every tenant table, one helper
(`current_user_org_ids()`) drives every policy. The BFF also validates
`X-Org-Id` against membership and returns a real `403 org_forbidden` —
better UX than a silent `200 []` if the client is confused. Both paths
have tests.

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
seeded `acme-games` (~131k rows on that org). 25 iterations, first run discarded.

| variant                          |    p50 |    p95 | rows returned | approx bytes |
|----------------------------------|-------:|-------:|--------------:|-------------:|
| naive (SELECT + JS aggregate)    |  51 ms |  69 ms |        44,640 |     4,185 KB |
| optimised (`rpc_cohort_performance`) | 42 ms |  77 ms |             8 |       1.6 KB |

Latency is similar on localhost — 4 MB over loopback is basically free.
Over a real VPC it isn't, and either way the plan is the interesting part.

<details>
<summary>EXPLAIN before/after (warm cache)</summary>

Before, only the baseline `(org_id, cohort_date)` index:

```
Parallel Seq Scan on cohort_daily cd
  Filter: (cohort_date BETWEEN ... AND day_index <= 30 AND org_id = ...)
  Rows Removed by Filter: 116160
  Buffers: shared hit=5897
Execution Time: 26.7 ms
```

After adding `(org_id, cohort_date, day_index) INCLUDE (…)`:

```
Parallel Index Only Scan using cohort_daily_hot_path_idx on cohort_daily cd
  Index Cond: (all four columns)
  Heap Fetches: 0
  Buffers: shared hit=1512
Execution Time: 20.9 ms
```

Same rows, ~4× fewer buffer reads, `Heap Fetches: 0` — the index carries
every projected column, no heap access. On a larger dataset (bump the
seed via `SEED_COHORT_DAYS=180 SEED_CAMPAIGNS_PER_ORG=20`) the gap widens
to ~5×. Full plans in `bench/results/`.

</details>

## Quickstart

Prereqs: Docker, Node 20 (nvm), pnpm 10, `supabase` CLI (`npm i -g supabase`),
Deno (`curl -fsSL https://deno.land/install.sh | sh`). Full walk-through in
[SETUP.md](SETUP.md).

```bash
pnpm install
supabase start                              # ~1 min first time
pnpm db:reset && pnpm db:seed               # ~4s, ~400k rows
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

## Limits worth flagging

- Seed users are inserted with raw SQL and a matching `auth.identities`
  row, which means the seeder has to set every string column GoTrue's Go
  struct reads as raw `string`. The current seeder covers what's needed
  for Supabase Cloud today, but the boundary between "our SQL" and
  "Supabase's schema" is real; production would go through
  `supabase.auth.admin.createUser`.
- `pROAS` in responses is `ROAS × 1.5` — a placeholder for a real
  prediction model. Every LLM tool description and every UI cell flags it
  as a prediction.
- The Meta Ads connector in `bench/` is fake. It exists to show the shape
  of an ingest pipeline (retry with jitter, token-bucket rate limit,
  idempotent upsert on the natural key). A real one has a lot more
  edge cases.
- No SKAN / probabilistic attribution. Separate math problem, out of scope.
- No caching layer. Would add ETag + a Redis rollup once the read patterns
  are actually known, not up-front.

## Deploy

See [DEPLOY.md](DEPLOY.md) for pushing the schema + Edge Functions to a
Supabase project and the dashboard to Vercel.

## License

MIT.
