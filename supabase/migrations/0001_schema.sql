-- 0001_schema.sql
-- Multi-tenant ad-analytics schema. Structure only; RLS in 0002, indexes in 0003.
-- Money is stored as bigint micros in the source currency. Conversion to USD
-- happens exactly once, in a shared BFF helper (see supabase/functions/_shared).
-- Dates on cohort_daily are stored UTC; every response is bucketed in the org's
-- reporting_timezone at the BFF layer.

create extension if not exists pgcrypto;

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency text not null check (char_length(base_currency) = 3),
  reporting_timezone text not null
);

-- Membership carries the tenant scope. Auth uid comes from Supabase auth.users;
-- we don't FK to auth.users to keep migrations independent of the auth schema.
create table org_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner','analyst','viewer')),
  primary key (org_id, user_id)
);

create table apps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  platform text not null check (platform in ('ios','android','web'))
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  app_id uuid not null references apps(id) on delete cascade,
  external_id text not null,
  name text not null,
  channel text not null check (channel in ('meta','tiktok','google_ads','asa','snapchat')),
  country text not null
);

create table creatives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  format text not null check (format in ('video','image','playable'))
);

-- cohort_date: UTC acquisition date. day_index: days since install (0..90).
-- creative_id is nullable (campaign-level cohorts exist). Postgres 15+ lets us
-- treat NULL as a real key value via `nulls not distinct` on a UNIQUE constraint,
-- but PRIMARY KEY requires NOT NULL columns — so the natural key is expressed as
-- a UNIQUE constraint and the table has no separate synthetic PK. This is
-- deliberately simple; we never row-address cohort_daily by a surrogate id.
create table cohort_daily (
  org_id uuid not null,
  campaign_id uuid not null,
  creative_id uuid,
  cohort_date date not null,
  day_index int not null check (day_index between 0 and 90),
  country text not null,
  platform text not null check (platform in ('ios','android','web')),
  installs int not null check (installs >= 0),
  spend_micros bigint not null check (spend_micros >= 0),
  revenue_micros bigint not null check (revenue_micros >= 0),
  currency text not null check (char_length(currency) = 3),
  constraint cohort_daily_natural_key
    unique nulls not distinct (org_id, campaign_id, creative_id, cohort_date, day_index, country)
);

create table fx_rates (
  day date not null,
  currency text not null check (char_length(currency) = 3),
  rate_to_usd numeric(20, 10) not null check (rate_to_usd > 0),
  primary key (day, currency)
);
