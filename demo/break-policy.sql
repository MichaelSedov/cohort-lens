-- Runtime "break-glass" patch that widens current_user_org_ids() to return
-- every org_id — dropping the where user_id = auth.uid() filter.
--
-- This is the *live* version used in DEMO.md; run with:
--   docker exec -i supabase_db_cohort-lens psql -U postgres < demo/break-policy.sql
-- then re-run `pnpm vitest run tests/rls.spec.ts` to watch the isolation
-- suite fail. Undo with demo/restore-policy.sql (~1 second, no reset needed).

create or replace function public.current_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  -- BUG: dropped the "where user_id = auth.uid()" filter. Any authenticated
  -- user now sees every org.
  select org_id from public.org_members;
$$;
