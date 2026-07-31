# Deploy

Two moving parts: the web dashboard (static build, goes to Vercel) and the
BFF + database (goes to a Supabase project).

## 1. Supabase project

Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
Note the **project ref**, **anon key**, and **service_role key** from
`Settings → API`.

Link the local repo to it and push the schema:

```bash
supabase login
supabase link --project-ref <your-ref>
supabase db push                 # applies supabase/migrations/*
```

Seed the remote DB once. The seeder reads `DATABASE_URL` — grab the
pooler URL from `Settings → Database → Connection string (Session mode)`
and run:

```bash
DATABASE_URL='postgres://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  pnpm db:seed
```

Deploy the Edge Functions:

```bash
supabase functions deploy cohort-performance cohort-compare creative-score campaigns ask
# and set the OpenRouter secret for the ask function:
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-... OPENROUTER_MODEL=anthropic/claude-haiku-4.5
```

## 2. Vercel

Import the repo at [vercel.com/new](https://vercel.com/new). Vercel picks
up `vercel.json` at the root — it already builds `web/` and rewrites for
SPA routing. Leave "Root Directory" as the repo root.

Set two environment variables in `Settings → Environment Variables`:

| name                       | value                                       |
|----------------------------|---------------------------------------------|
| `VITE_SUPABASE_URL`        | `https://<your-ref>.supabase.co`            |
| `VITE_SUPABASE_ANON_KEY`   | anon key from Supabase `Settings → API`     |

Both are safe to expose (they're the anon path; RLS + Auth still guard the
data). Trigger a deploy.

## 3. Sanity checks after first deploy

- Open the Vercel URL, log in as one of the seed users. Table should render.
- Ask the AI panel a question. Watch for a CORS error in DevTools — if
  something breaks it will almost certainly be here.
- In Supabase `Auth → Users`, confirm you can see the seeded users. If not,
  the seeder didn't run against the remote DB.
- Optional: rotate the anon key later once the demo audience shrinks.

## Notes

- The MCP server (`mcp-server/`) is a local process, not something you
  deploy. Point it at the deployed BFF by exporting
  `COHORT_LENS_URL=https://<ref>.supabase.co/functions/v1` and a JWT
  minted against the remote project.
- The bench (`bench/`) is a local dev script; it needs `DATABASE_URL`.
- CI still runs the full local stack — deploys are downstream of green CI.
