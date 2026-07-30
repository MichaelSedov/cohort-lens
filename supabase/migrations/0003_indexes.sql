-- 0003_indexes.sql
-- Baseline indexes only. The composite "hot path" index for /cohort-performance
-- is deliberately deferred to Phase 5 so the benchmark can measure the before /
-- after impact and document EXPLAIN ANALYZE output in the README.

create index campaigns_org_app_idx    on campaigns (org_id, app_id);
create index creatives_org_campaign_idx on creatives (org_id, campaign_id);
create index cohort_daily_org_date_idx on cohort_daily (org_id, cohort_date);
create index org_members_user_idx     on org_members (user_id);
