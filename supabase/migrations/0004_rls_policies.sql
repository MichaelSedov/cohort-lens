-- 0004_rls_policies.sql
-- Tenant isolation policies. The membership check is centralised in one
-- SECURITY DEFINER helper so every policy is a one-liner and there is exactly
-- one place to audit or change the definition of "which orgs can I see".
--
-- Design notes:
--   * Every tenant-scoped SELECT/INSERT/UPDATE/DELETE resolves to the same
--     predicate: `org_id in (select current_user_org_ids())`.
--   * `fx_rates` is reference data, not tenant-scoped — readable by any
--     authenticated user, no write policy (only the seeder / service_role
--     writes it).
--   * The BFF *additionally* validates X-Org-Id against org_members before
--     forwarding the JWT (belt-and-braces). RLS here is the enforcement
--     boundary; the BFF check is a defence-in-depth error surface (403 vs.
--     silent empty result).

create or replace function public.current_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

revoke all on function public.current_user_org_ids() from public;
grant execute on function public.current_user_org_ids() to authenticated;

-- orgs / org_members: read-only from the app
create policy orgs_tenant_read on orgs
  for select to authenticated
  using (id in (select public.current_user_org_ids()));

create policy org_members_tenant_read on org_members
  for select to authenticated
  using (org_id in (select public.current_user_org_ids()));

-- apps / campaigns / creatives / cohort_daily: full CRUD within own org
create policy apps_tenant on apps
  for all to authenticated
  using (org_id in (select public.current_user_org_ids()))
  with check (org_id in (select public.current_user_org_ids()));

create policy campaigns_tenant on campaigns
  for all to authenticated
  using (org_id in (select public.current_user_org_ids()))
  with check (org_id in (select public.current_user_org_ids()));

create policy creatives_tenant on creatives
  for all to authenticated
  using (org_id in (select public.current_user_org_ids()))
  with check (org_id in (select public.current_user_org_ids()));

create policy cohort_daily_tenant on cohort_daily
  for all to authenticated
  using (org_id in (select public.current_user_org_ids()))
  with check (org_id in (select public.current_user_org_ids()));

-- fx_rates: reference data readable by all authenticated users
create policy fx_rates_read on fx_rates
  for select to authenticated
  using (true);

-- Table-level GRANTs. Without these, RLS never even runs — Postgres rejects
-- at the privilege layer with "permission denied for table X". Policies only
-- narrow what an already-privileged role can see.
grant select on orgs, org_members, fx_rates to authenticated;
grant select, insert, update, delete on apps, campaigns, creatives, cohort_daily to authenticated;
