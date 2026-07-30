-- 0005_rpc_functions.sql
-- Aggregation RPCs. All SECURITY INVOKER: RLS is the enforcement boundary, so
-- the caller's org membership scopes the row set naturally. USD conversion
-- happens exactly once, in these functions, joining to fx_rates by the
-- cohort_date and source currency.
--
-- Filters are passed as jsonb so we can add dimensions without changing the
-- function signature; the values inside are treated as text arrays.

set search_path = public;

--------------------------------------------------------------------------------
-- rpc_cohort_performance
--------------------------------------------------------------------------------
-- Aggregates cohort_daily rows through `day_index_max` (the pROAS horizon),
-- grouped by up to 3 dimensions. Returns per-key metrics in USD.
create or replace function rpc_cohort_performance(
  date_from    date,
  date_to      date,
  day_index_max int,
  group_by     text[],
  filters      jsonb,
  sort_field   text,     -- 'spendUsd' | 'revenueUsd' | 'installs' | 'roas'
  sort_dir     text,     -- 'asc' | 'desc'
  page_limit   int,
  page_offset  int
)
returns table (
  key         jsonb,
  installs    bigint,
  spend_usd   numeric,
  revenue_usd numeric,
  row_count   bigint     -- total matching keys before pagination
) language plpgsql stable security invoker
as $$
declare
  sort_col text;
  sort_dir_norm text;
begin
  if sort_dir not in ('asc','desc') then
    raise exception 'invalid sort_dir: %', sort_dir using errcode = '22023';
  end if;
  sort_dir_norm := sort_dir;

  sort_col := case sort_field
    when 'spendUsd'   then 'spend_usd'
    when 'revenueUsd' then 'revenue_usd'
    when 'installs'   then 'installs'
    when 'roas'       then 'case when spend_usd = 0 then 0 else revenue_usd / spend_usd end'
    else null
  end;
  if sort_col is null then
    raise exception 'invalid sort_field: %', sort_field using errcode = '22023';
  end if;

  return query execute format($sql$
    with filtered as (
      select
        c.channel        as channel,
        cd.country       as country,
        cd.platform      as platform,
        cd.campaign_id   as campaign_id,
        cd.creative_id   as creative_id,
        cd.installs      as installs,
        cd.spend_micros  as spend_micros,
        cd.revenue_micros as revenue_micros,
        fx.rate_to_usd   as rate_to_usd
      from cohort_daily cd
      join campaigns c on c.id = cd.campaign_id
      left join fx_rates fx on fx.day = cd.cohort_date and fx.currency = cd.currency
      where cd.cohort_date between $1 and $2
        and cd.day_index <= $3
        and ($5->'channel'  is null or c.channel   = any(array(select jsonb_array_elements_text($5->'channel'))))
        and ($5->'country'  is null or cd.country  = any(array(select jsonb_array_elements_text($5->'country'))))
        and ($5->'platform' is null or cd.platform = any(array(select jsonb_array_elements_text($5->'platform'))))
    ),
    grouped as (
      select
        jsonb_strip_nulls(jsonb_build_object(
          'channel',  case when 'channel'  = any($4) then max(channel)  end,
          'country',  case when 'country'  = any($4) then max(country)  end,
          'platform', case when 'platform' = any($4) then max(platform) end,
          'campaign', case when 'campaign' = any($4) then max(campaign_id::text) end,
          'creative', case when 'creative' = any($4) then max(coalesce(creative_id::text, '')) end
        )) as key,
        sum(installs)::bigint as installs,
        (sum(spend_micros::numeric   * coalesce(rate_to_usd, 1)) / 1000000.0)::numeric(20,4) as spend_usd,
        (sum(revenue_micros::numeric * coalesce(rate_to_usd, 1)) / 1000000.0)::numeric(20,4) as revenue_usd
      from filtered
      group by
        case when 'channel'  = any($4) then channel  end,
        case when 'country'  = any($4) then country  end,
        case when 'platform' = any($4) then platform end,
        case when 'campaign' = any($4) then campaign_id::text end,
        case when 'creative' = any($4) then coalesce(creative_id::text, '') end
    ),
    counted as (
      select *, count(*) over () as row_count from grouped
    )
    select key, installs, spend_usd, revenue_usd, row_count
    from counted
    order by %s %s
    limit $6 offset $7
  $sql$, sort_col, sort_dir_norm)
  using date_from, date_to, day_index_max, group_by, filters, page_limit, page_offset;
end;
$$;

grant execute on function rpc_cohort_performance to authenticated;

--------------------------------------------------------------------------------
-- rpc_cohort_compare
--------------------------------------------------------------------------------
-- Runs cohort_performance for two periods and returns per-key deltas. The
-- caller chooses the same groupBy/filters for both periods; keys that appear
-- in only one period are still returned (deltas computed against 0).
create or replace function rpc_cohort_compare(
  a_from  date, a_to  date,
  b_from  date, b_to  date,
  day_index_max int,
  group_by  text[],
  filters   jsonb,
  low_volume_threshold int default 100
)
returns table (
  key           jsonb,
  a_installs    bigint,   a_spend_usd numeric, a_revenue_usd numeric,
  b_installs    bigint,   b_spend_usd numeric, b_revenue_usd numeric,
  significance  text      -- 'ok' | 'low_volume'
) language sql stable security invoker
as $$
  with a as (
    select key, installs, spend_usd, revenue_usd
    from rpc_cohort_performance(a_from, a_to, day_index_max, group_by, filters,
                                'spendUsd', 'desc', 100000, 0)
  ),
  b as (
    select key, installs, spend_usd, revenue_usd
    from rpc_cohort_performance(b_from, b_to, day_index_max, group_by, filters,
                                'spendUsd', 'desc', 100000, 0)
  )
  select
    coalesce(a.key, b.key) as key,
    coalesce(a.installs, 0), coalesce(a.spend_usd, 0), coalesce(a.revenue_usd, 0),
    coalesce(b.installs, 0), coalesce(b.spend_usd, 0), coalesce(b.revenue_usd, 0),
    case when coalesce(a.installs, 0) < low_volume_threshold
           or coalesce(b.installs, 0) < low_volume_threshold
         then 'low_volume' else 'ok' end
  from a full outer join b on a.key = b.key;
$$;

grant execute on function rpc_cohort_compare to authenticated;

--------------------------------------------------------------------------------
-- rpc_creative_score
--------------------------------------------------------------------------------
-- Returns per-creative component metrics (in USD) for the given campaigns
-- and/or creatives. Score composition and weighting are applied in TypeScript
-- so unit tests can exercise the formula without a DB round-trip.
--
--   pRoas          = revenueUsd(through horizon) / spendUsd
--   d7_over_d0_rev = ratio of D7 cumulative to D0 revenue (retention proxy)
--   cpi_usd        = spendUsd / installs
--   spendUsd       = raw acquisition spend (drives the confidence weight)
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
  with base as (
    select cd.*, fx.rate_to_usd
    from cohort_daily cd
    left join fx_rates fx on fx.day = cd.cohort_date and fx.currency = cd.currency
    where cd.creative_id is not null
      and cd.cohort_date >= (current_date - benchmark_window_days)
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

grant execute on function rpc_creative_score to authenticated;
