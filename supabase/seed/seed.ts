// Deterministic synthetic data generator. Usage:
//   pnpm db:seed                       # uses SEED env or 42
//   node --import tsx/esm seed.ts --seed 42
//
// The seeder connects with the Postgres superuser (local supabase default)
// and bypasses RLS by design. It also creates users in auth.users via direct
// SQL — a documented shortcut for a local dev seeder; production would use
// the GoTrue admin API.

import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { addDays } from "date-fns";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  buildOrgs,
  buildApps,
  buildCampaigns,
  buildCreatives,
  buildFxRates,
  buildCohortRows,
  USERS,
  type CohortRow,
} from "./generate.ts";
import { makeRng } from "./rng.ts";

const args = process.argv.slice(2);
const seedFlagIdx = args.indexOf("--seed");
const seed =
  seedFlagIdx >= 0 ? Number(args[seedFlagIdx + 1]) : Number(process.env.SEED ?? 42);

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Row-budget knobs. Defaults keep the seeded DB under ~150 MB so it fits
// Supabase's Free tier (500 MB soft cap). Bench and RLS story still work.
// Override with SEED_COHORT_DAYS / SEED_CREATIVE_WINDOW / SEED_CAMPAIGNS_PER_ORG
// if you're on Pro or running locally and want the fatter dataset.
const COHORT_DAYS = Number(process.env.SEED_COHORT_DAYS ?? 90);
const CREATIVE_COHORT_WINDOW = Number(process.env.SEED_CREATIVE_WINDOW ?? 45);

// Cohort start date is deterministic so re-runs produce identical fx_rates keys.
const START_DATE = new Date(Date.UTC(2026, 0, 1)); // 2026-01-01

function fmt(t0: number) {
  return `${((performance.now() - t0) / 1000).toFixed(2)}s`;
}

async function main() {
  const t0 = performance.now();
  const rng = makeRng(seed);
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  // Supabase pooler (session mode) can hand out sessions whose default
  // transaction is read-only — force read-write once so UPDATE / INSERT
  // work everywhere the seeder needs them.
  await client.query("set session default_transaction_read_only = off");

  console.log(`[seed] connected, seed=${seed}`);

  // Idempotency: truncate our tables. auth.users we insert with ON CONFLICT.
  await client.query("begin");
  await client.query(`
    truncate table cohort_daily, creatives, campaigns, apps, org_members, fx_rates, orgs
    restart identity cascade;
  `);

  const orgs = buildOrgs(rng);
  const apps = buildApps(rng, orgs);
  const campaigns = buildCampaigns(rng, apps);
  const creatives = buildCreatives(rng, campaigns);
  const fxRates = buildFxRates(START_DATE, COHORT_DAYS + 91); // cover last cohort's D90

  console.log(
    `[seed] generated in-memory dims: orgs=${orgs.length} apps=${apps.length} campaigns=${campaigns.length} creatives=${creatives.length} fx=${fxRates.length}  (${fmt(t0)})`,
  );

  // --- Insert users into auth.users (idempotent via SELECT-then-INSERT) --------
  // auth.users has a partial unique index we can't safely reference in ON CONFLICT,
  // so we look up by email and only insert when missing.
  const upsertAuthUser = async (email: string): Promise<{ id: string; email: string }> => {
    const existing = await client.query<{ id: string; email: string }>(
      `select id, email from auth.users where email = $1 limit 1`,
      [email],
    );
    if (existing.rows.length > 0) return existing.rows[0]!;
    // Every varchar/text column that GoTrue's Go struct reads as `string`
    // (not sql.NullString) has to be an empty string, not NULL, or login
    // errors with "converting NULL to string is unsupported". Cloud is
    // stricter than the local docker stack — belt every column here.
    const inserted = await client.query<{ id: string; email: string }>(
      `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, created_at, updated_at,
          raw_app_meta_data, raw_user_meta_data, is_super_admin,
          confirmation_token, email_change, email_change_token_new,
          email_change_token_current, recovery_token, reauthentication_token,
          phone_change, phone_change_token)
       values (
         '00000000-0000-0000-0000-000000000000',
         gen_random_uuid(), 'authenticated', 'authenticated',
         $1, crypt('password', gen_salt('bf')),
         now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false,
         '', '', '', '', '', '', '', ''
       )
       returning id, email;`,
      [email],
    );
    const user = inserted.rows[0]!;
    // GoTrue requires an auth.identities row per user for email/password
    // logins. Direct INSERT into auth.users alone doesn't create one; we
    // build the identity here with the same JSONB shape GoTrue writes.
    // `email` is a generated column, so we omit it from the column list.
    await client.query(
      `insert into auth.identities
         (id, user_id, provider_id, provider, identity_data,
          created_at, updated_at, last_sign_in_at)
       values
         (gen_random_uuid(), $1::uuid, $1::text, 'email',
          jsonb_build_object(
            'sub',            $1::text,
            'email',          $2::text,
            'email_verified', true,
            'phone_verified', false),
          now(), now(), now())
       on conflict do nothing;`,
      [user.id, user.email],
    );
    return user;
  };
  const userIds: { email: string; id: string }[] = [];
  for (const org of orgs) {
    for (const spec of USERS.perOrg) {
      userIds.push(await upsertAuthUser(`${spec.emailSuffix}@${org.name}.test`));
    }
  }
  userIds.push(await upsertAuthUser(USERS.crossOrg.email));
  console.log(`[seed] auth.users ready: ${userIds.length}  (${fmt(t0)})`);

  // --- orgs ---
  for (const o of orgs) {
    await client.query(
      `insert into orgs (id, name, base_currency, reporting_timezone) values ($1,$2,$3,$4)`,
      [o.id, o.name, o.base_currency, o.reporting_timezone],
    );
  }

  // --- org_members ---
  const emailById = new Map(userIds.map((u) => [u.email, u.id] as const));
  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i]!;
    for (const spec of USERS.perOrg) {
      const uid = emailById.get(`${spec.emailSuffix}@${org.name}.test`)!;
      await client.query(
        `insert into org_members (org_id, user_id, role) values ($1,$2,$3)`,
        [org.id, uid, spec.role],
      );
    }
  }
  const crossUid = emailById.get(USERS.crossOrg.email)!;
  for (const idx of USERS.crossOrg.orgIndices) {
    await client.query(
      `insert into org_members (org_id, user_id, role) values ($1,$2,$3)`,
      [orgs[idx]!.id, crossUid, USERS.crossOrg.role],
    );
  }

  // --- apps / campaigns / creatives (batched INSERTs — small volumes) ---
  for (const a of apps) {
    await client.query(
      `insert into apps (id, org_id, name, platform) values ($1,$2,$3,$4)`,
      [a.id, a.org_id, a.name, a.platform],
    );
  }
  for (const c of campaigns) {
    await client.query(
      `insert into campaigns (id, org_id, app_id, external_id, name, channel, country)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [c.id, c.org_id, c.app_id, c.external_id, c.name, c.channel, c.country],
    );
  }
  for (const cr of creatives) {
    await client.query(
      `insert into creatives (id, org_id, campaign_id, name, format) values ($1,$2,$3,$4,$5)`,
      [cr.id, cr.org_id, cr.campaign_id, cr.name, cr.format],
    );
  }
  console.log(`[seed] dims inserted  (${fmt(t0)})`);

  // --- fx_rates (COPY) ---
  await copyRows(
    client,
    "fx_rates(day, currency, rate_to_usd)",
    fxRates.map((r) => [r.day, r.currency, r.rate_to_usd]),
  );

  // --- cohort_daily (COPY, per-org streaming to keep memory bounded) ---
  let totalCohort = 0;
  for (const org of orgs) {
    const rows = buildCohortRows(
      rng,
      org,
      campaigns,
      creatives,
      apps,
      START_DATE,
      COHORT_DAYS,
      CREATIVE_COHORT_WINDOW,
    );
    await copyRows(
      client,
      "cohort_daily(org_id, campaign_id, creative_id, cohort_date, day_index, country, platform, installs, spend_micros, revenue_micros, currency)",
      rows.map((r: CohortRow) => [
        r.org_id,
        r.campaign_id,
        r.creative_id ?? "\\N",
        r.cohort_date,
        String(r.day_index),
        r.country,
        r.platform,
        String(r.installs),
        r.spend_micros.toString(),
        r.revenue_micros.toString(),
        r.currency,
      ]),
    );
    totalCohort += rows.length;
    console.log(`[seed]   org ${org.name}: ${rows.length} cohort rows  (${fmt(t0)})`);
  }

  await client.query("commit");
  console.log(`[seed] commit done. total cohort_daily=${totalCohort}  (${fmt(t0)})`);

  // Update planner stats + visibility map so the covering index enables
  // Index-Only Scan on first query. Without this, autovacuum eventually
  // catches up but the first few benchmark runs would be slow for no reason.
  console.log(`[seed] running VACUUM ANALYZE (planner stats + visibility map)...`);
  await client.query("vacuum analyze cohort_daily");
  await client.query("vacuum analyze fx_rates");
  await client.query("vacuum analyze campaigns");
  console.log(`[seed] vacuum done  (${fmt(t0)})`);

  // Summary
  const counts = await client.query(`
    select 'orgs' t, count(*)::int c from orgs
    union all select 'org_members', count(*)::int from org_members
    union all select 'apps', count(*)::int from apps
    union all select 'campaigns', count(*)::int from campaigns
    union all select 'creatives', count(*)::int from creatives
    union all select 'fx_rates', count(*)::int from fx_rates
    union all select 'cohort_daily', count(*)::int from cohort_daily
    order by t;
  `);
  console.table(counts.rows);

  await client.end();
  console.log(`[seed] done in ${fmt(t0)}`);
}

/**
 * Bulk-load a set of pre-serialised text rows using the Postgres COPY protocol.
 * Rows are already coerced to strings; NULLs are represented as the literal "\N".
 */
async function copyRows(client: Client, spec: string, rows: string[][]) {
  const t0 = performance.now();
  const stream = client.query(copyFrom(`copy ${spec} from stdin with (format text)`));
  const src = Readable.from(rowIterator(rows), { objectMode: false });
  await pipeline(src, stream);
  console.log(`[seed]   COPY ${spec.split("(")[0]}: ${rows.length} rows in ${fmt(t0)}`);
}

function* rowIterator(rows: string[][]): Generator<Buffer> {
  const CHUNK = 4096;
  let buf = "";
  for (const r of rows) {
    // COPY text format: tab-separated, \N for NULL; escape \ and \t and \n.
    const line = r
      .map((v) => {
        if (v === "\\N") return v;
        return v
          .replace(/\\/g, "\\\\")
          .replace(/\t/g, "\\t")
          .replace(/\n/g, "\\n")
          .replace(/\r/g, "\\r");
      })
      .join("\t");
    buf += line + "\n";
    if (buf.length > CHUNK) {
      yield Buffer.from(buf);
      buf = "";
    }
  }
  if (buf) yield Buffer.from(buf);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
