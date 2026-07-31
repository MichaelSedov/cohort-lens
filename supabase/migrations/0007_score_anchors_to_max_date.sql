-- 0007_score_anchors_to_max_date.sql
-- rpc_creative_score used `current_date - benchmark_window_days` as the
-- lower bound of the benchmark window. That works in production where the
-- ETL keeps cohort_daily current, but breaks against any static dataset
-- (demos, tests, staging clones) where cohort_daily's max date is older
-- than today — the RPC returns zero rows even though data exists.
--
-- Fix: anchor to `max(cohort_date)` instead of `current_date`. Semantically
-- unchanged in prod (max(cohort_date) tracks current_date under normal
-- ingest), and self-correcting for any lagging dataset.

create or replace function rpc_creative_score(
  campaign_ids uuid[],
  creative_ids uuid[],
  day_index_horizon int,
  benchmark_window_days int
)
returns table (
  creative_id   uuid,
  campaign_id   uuid,
  installs      bigint,
  spend_usd     numeric,
  revenue_usd_horizon numeric,
  d0_revenue_usd numeric,
  d7_revenue_usd numeric,
  cpi_usd       numeric,
  p_roas        numeric
) language sql stable security invoker
as $$
  with anchor as (
    -- Freshest cohort_date the CALLER can see (RLS applies inside this
    -- subquery, so it's per-tenant not global).
    select max(cohort_date) as max_date from cohort_daily
  ),
  base as (
    select cd.*, fx.rate_to_usd
    from cohort_daily cd
    left join fx_rates fx on fx.day = cd.cohort_date and fx.currency = cd.currency
    cross join anchor
    where cd.creative_id is not null
      and cd.cohort_date >= (anchor.max_date - benchmark_window_days)
      and (
        (campaign_ids is not null and cd.campaign_id = any(campaign_ids)) or
        (creative_ids is not null and cd.creative_id = any(creative_ids))
      )
  ),
  agg as (
    select
      creative_id,
      campaign_id,
      sum(installs)::bigint as installs,
      (sum(case when day_index = 0 then spend_micros end)::numeric
        * coalesce(max(rate_to_usd), 1) / 1000000.0)::numeric(20,4) as spend_usd,
      (sum(case when day_index <= day_index_horizon then revenue_micros end)::numeric
        * coalesce(max(rate_to_usd), 1) / 1000000.0)::numeric(20,4) as revenue_usd_horizon,
      (sum(case when day_index = 0 then revenue_micros end)::numeric
        * coalesce(max(rate_to_usd), 1) / 1000000.0)::numeric(20,4) as d0_revenue_usd,
      (sum(case when day_index <= 7 then revenue_micros end)::numeric
        * coalesce(max(rate_to_usd), 1) / 1000000.0)::numeric(20,4) as d7_revenue_usd
    from base
    group by creative_id, campaign_id
  )
  select
    creative_id, campaign_id, installs,
    spend_usd,
    revenue_usd_horizon,
    d0_revenue_usd,
    d7_revenue_usd,
    case when installs = 0 then 0 else spend_usd / installs end as cpi_usd,
    case when spend_usd = 0 then 0 else revenue_usd_horizon / spend_usd end as p_roas
  from agg;
$$;
