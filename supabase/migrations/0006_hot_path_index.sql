-- 0006_hot_path_index.sql
-- Composite covering index for the /cohort-performance hot path.
--
-- The RPC filters on (org_id, cohort_date range, day_index <= H) and needs
-- installs, spend_micros, revenue_micros, currency, campaign_id, country to
-- compute a group-by. Placing (org_id, cohort_date, day_index) as the key and
-- carrying the projected columns via INCLUDE lets Postgres do an index-only
-- scan for this query — no heap fetch, and the day_index range predicate
-- prunes subtrees at the leaf level rather than filtering after.
--
-- Trade-off: the index adds ~40% storage on top of the table's heap and
-- slows writes proportionally. That's fine for cohort_daily — this table is
-- write-once from the ETL and read many times per user session. See the
-- README's "Decisions & trade-offs" for the wider discussion.

create index cohort_daily_hot_path_idx
  on cohort_daily (org_id, cohort_date, day_index)
  include (campaign_id, country, installs, spend_micros, revenue_micros, currency);

-- The old broad index is now redundant for this hot path (the new one is a
-- superset), but we keep it — other endpoints (`/campaigns`, ad-hoc queries)
-- may still benefit and its cost is small compared to the wins.
