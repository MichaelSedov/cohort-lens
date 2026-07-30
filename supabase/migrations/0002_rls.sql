-- 0002_rls.sql
-- Enable RLS on every tenant table with a fail-closed default (deny all).
-- Real policies are added in Phase 3, alongside the isolation test suite that
-- proves each policy grants exactly what it should and no more.

alter table orgs         enable row level security;
alter table org_members  enable row level security;
alter table apps         enable row level security;
alter table campaigns    enable row level security;
alter table creatives    enable row level security;
alter table cohort_daily enable row level security;
alter table fx_rates     enable row level security;

-- No policies granted => authenticated/anon roles cannot see any row.
-- The seeder uses the service_role, which bypasses RLS by design.
