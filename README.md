# cohort-lens

A vertical slice of a multi-tenant marketing-analytics platform: **Postgres (Supabase) + RLS → Deno Edge Functions BFF → MCP server** so an LLM can query tenant-scoped ad performance in natural language. Interview artifact — small, complete, defensible.

Status: **Phase 1 scaffold** (see `PHASES.md` / commit history).

## Stack

| Layer | Tech |
| --- | --- |
| DB | Supabase local (Docker), Postgres 15 |
| Migrations | Supabase SQL migrations in `supabase/migrations/` |
| BFF | Supabase Edge Functions (Deno, TS strict) |
| Validation | Zod |
| MCP | `@modelcontextprotocol/sdk`, stdio, Node 20 + TS strict |
| Tests | Vitest (Node), `deno test` where it fits |
| CI | GitHub Actions |
| Package manager | pnpm |

## Quickstart (clean machine)

Prereqs: Docker, Node 20 (via nvm), pnpm 10, `supabase` CLI (`npm i -g supabase`), Deno (`curl -fsSL https://deno.land/install.sh | sh`).

```bash
git clone <repo> && cd cohort-lens
cp .env.example .env
pnpm install
pnpm db:start          # boots Supabase locally (Docker)
pnpm db:reset && pnpm db:seed
pnpm functions:serve   # BFF on :54321/functions/v1
pnpm mcp:dev           # MCP stdio server (in a separate shell)
```

Sections coming in later phases: architecture diagram, decisions & trade-offs, benchmark table, "what I'd do next", DEMO walkthrough.
