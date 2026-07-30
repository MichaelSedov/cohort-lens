# SETUP — clean machine

Tested on macOS Sequoia (M-series) and Ubuntu 24.04. Should work anywhere
Docker + Node 20 do.

## 1. Prereqs

| tool             | recommended install                                                  |
|------------------|----------------------------------------------------------------------|
| Docker           | Docker Desktop (macOS) or `docker` + `docker compose` (Linux)        |
| Node 20          | `nvm install 20 && nvm use 20`                                       |
| pnpm 10          | `npm i -g pnpm@10`                                                   |
| Supabase CLI     | `npm i -g supabase` (brew tap also works; brew formula requires up-to-date Xcode CLT) |
| Deno 2           | `curl -fsSL https://deno.land/install.sh \| sh` — put `~/.deno/bin` on `$PATH` |

Quick sanity check:

```bash
docker info >/dev/null && echo ok
node -v      # v20.x
pnpm -v      # 10.x
supabase --version
deno --version
```

## 2. Clone + install

```bash
git clone <this repo> cohort-lens
cd cohort-lens
cp .env.example .env         # optional — the seeder/CI have working defaults
pnpm install
```

## 3. Boot the local Supabase stack

```bash
supabase start
```

First run pulls ~2 GB of images; subsequent runs are ~10 seconds. `supabase
status` prints the local URLs and keys.

## 4. Apply migrations + seed the data

```bash
pnpm db:reset      # applies supabase/migrations/000{1..6}
pnpm db:seed       # ~30s, ~1.97M cohort_daily rows, deterministic --seed 42
```

The seeder also runs `VACUUM ANALYZE` at the end so the planner has fresh
stats + a hot visibility map — otherwise the first several benchmark runs
are slow for no reason.

## 5. Start the BFF and (optionally) the MCP server

In one shell:

```bash
pnpm functions:serve   # BFF on :54321/functions/v1
```

In another (for the MCP server):

```bash
eval "$(node scripts/sign-mcp-jwt.mjs)"        # analyst@acme-games.test by default
# or: node scripts/sign-mcp-jwt.mjs analyst@shared.test  (cross-org user)
pnpm mcp:dev                                    # stdio
# or: pnpm mcp:inspect                          # opens MCP Inspector in browser
```

`sign-mcp-jwt.mjs` prints the three `export` lines for
`COHORT_LENS_URL`/`COHORT_LENS_JWT`/`COHORT_LENS_ORG_ID`. `eval "$(...)"`
sets them in the current shell.

## 6. Run everything

```bash
pnpm typecheck   # tsc across workspaces + `deno check` on the functions
pnpm test        # 43 tests: rls · rls-403 · contract · connector · mcp-client · units
pnpm bench       # writes bench/results/bench.md; exits non-zero if p95 ≥ 250ms
```

## Troubleshooting

**`docker info` fails with "cannot connect"** — Docker Desktop isn't
running. Start it, wait for the whale to settle.

**`supabase start` complains about socket paths** — Docker Desktop uses
`~/.docker/run/docker.sock`; the Supabase CLI reads it from Docker context.
If broken, `docker context use desktop-linux`.

**Contract tests fail with `ECONNREFUSED`** — `pnpm functions:serve` isn't
running. Start it in another shell before `pnpm test`.

**Benchmark p95 is huge on first run** — first query after a reset is cold;
the seeder now runs `VACUUM ANALYZE` so this shouldn't happen on a fresh
`pnpm db:seed`. If it does, run `docker exec supabase_db_cohort-lens psql -U
postgres -c "vacuum analyze cohort_daily"` and re-run.

**`deno: command not found` from `pnpm typecheck`** — the `typecheck:deno`
script prepends `~/.deno/bin` to `$PATH` automatically. If deno is
elsewhere, add it to your shell's `$PATH`.
