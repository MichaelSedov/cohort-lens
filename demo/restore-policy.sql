-- Restores the correct current_user_org_ids() after demo/break-policy.sql.
-- This is the same body that ships in supabase/migrations/0004_rls_policies.sql.

create or replace function public.current_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;
