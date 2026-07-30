import { addDays, formatISO } from "date-fns";
import type { Rng } from "./rng.ts";

export type Org = {
  id: string;
  name: string;
  base_currency: string;
  reporting_timezone: string;
};

export type Membership = { org_id: string; user_id: string; role: "owner" | "analyst" | "viewer" };

export type App = { id: string; org_id: string; name: string; platform: "ios" | "android" | "web" };

export type Campaign = {
  id: string;
  org_id: string;
  app_id: string;
  external_id: string;
  name: string;
  channel: "meta" | "tiktok" | "google_ads" | "asa" | "snapchat";
  country: string;
};

export type Creative = {
  id: string;
  org_id: string;
  campaign_id: string;
  name: string;
  format: "video" | "image" | "playable";
};

export type CohortRow = {
  org_id: string;
  campaign_id: string;
  creative_id: string | null;
  cohort_date: string; // ISO YYYY-MM-DD
  day_index: number;
  country: string;
  platform: "ios" | "android" | "web";
  installs: number;
  spend_micros: bigint;
  revenue_micros: bigint;
  currency: string;
};

export type FxRow = { day: string; currency: string; rate_to_usd: string };

// Deterministic UUIDv4-shaped id derived from the seeded RNG so re-runs are stable.
function uuid(rng: Rng): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) s += hex[rng.int(0, 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${"89ab"[rng.int(0, 4)]}${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

const CHANNELS = ["meta", "tiktok", "google_ads", "asa", "snapchat"] as const;
const FORMATS = ["video", "image", "playable"] as const;
const PLATFORMS = ["ios", "android", "web"] as const;
const COUNTRIES = ["US", "DE", "GB", "FR", "JP", "BR"] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "BRL"] as const;

export const ORG_SPECS = [
  { name: "acme-games", base_currency: "USD", tz: "America/Los_Angeles" },
  { name: "northwind-apps", base_currency: "EUR", tz: "Europe/Berlin" },
  { name: "zenith-vpn", base_currency: "GBP", tz: "Europe/London" },
];

export const USERS = {
  // Seed users: per-org emails + one cross-org analyst.
  perOrg: [
    { emailSuffix: "owner", role: "owner" as const },
    { emailSuffix: "analyst", role: "analyst" as const },
    { emailSuffix: "viewer", role: "viewer" as const },
  ],
  crossOrg: {
    email: "analyst@shared.test",
    role: "analyst" as const,
    // Belongs to the first two orgs.
    orgIndices: [0, 1] as const,
  },
};

export function buildOrgs(rng: Rng): Org[] {
  return ORG_SPECS.map((s) => ({
    id: uuid(rng),
    name: s.name,
    base_currency: s.base_currency,
    reporting_timezone: s.tz,
  }));
}

export function buildApps(rng: Rng, orgs: Org[]): App[] {
  const out: App[] = [];
  for (const org of orgs) {
    const n = rng.int(2, 5); // 2..4
    for (let i = 0; i < n; i++) {
      out.push({
        id: uuid(rng),
        org_id: org.id,
        name: `${org.name}-app-${i + 1}`,
        platform: PLATFORMS[i % PLATFORMS.length]!,
      });
    }
  }
  return out;
}

export function buildCampaigns(rng: Rng, apps: App[]): Campaign[] {
  const out: Campaign[] = [];
  const perOrg = new Map<string, App[]>();
  for (const a of apps) {
    if (!perOrg.has(a.org_id)) perOrg.set(a.org_id, []);
    perOrg.get(a.org_id)!.push(a);
  }
  for (const [orgId, orgApps] of perOrg) {
    const target = 20; // deterministic to keep row counts stable
    for (let i = 0; i < target; i++) {
      const app = orgApps[i % orgApps.length]!;
      const channel = CHANNELS[i % CHANNELS.length]!;
      const country = COUNTRIES[i % COUNTRIES.length]!;
      out.push({
        id: uuid(rng),
        org_id: orgId,
        app_id: app.id,
        external_id: `ext-${orgId.slice(0, 8)}-${i}`,
        name: `${channel}-${country}-camp-${i + 1}`,
        channel,
        country,
      });
    }
  }
  return out;
}

export function buildCreatives(rng: Rng, campaigns: Campaign[]): Creative[] {
  const out: Creative[] = [];
  // 20 creatives per campaign → 400/org, ~1200 total (within spec 300-600 per org for
  // "typical" but we widen so top-2 selection has choice).
  for (const c of campaigns) {
    for (let i = 0; i < 20; i++) {
      out.push({
        id: uuid(rng),
        org_id: c.org_id,
        campaign_id: c.id,
        name: `${c.name}-cr-${i + 1}`,
        format: FORMATS[i % FORMATS.length]!,
      });
    }
  }
  return out;
}

export function buildFxRates(startDate: Date, days: number): FxRow[] {
  const out: FxRow[] = [];
  // Fixed daily rates with small drift so USD conversion is deterministic and
  // easy to reason about in tests. USD is 1.0 by definition.
  const base: Record<string, number> = { USD: 1.0, EUR: 1.08, GBP: 1.27, JPY: 0.0067, BRL: 0.2 };
  for (let d = 0; d < days; d++) {
    const day = formatISO(addDays(startDate, d), { representation: "date" });
    for (const cur of CURRENCIES) {
      // Tiny sinusoidal drift so rates aren't identical across days.
      const drift = 1 + Math.sin(d / 30) * 0.01;
      out.push({ day, currency: cur, rate_to_usd: (base[cur]! * drift).toFixed(10) });
    }
  }
  return out;
}

/**
 * Generate cohort_daily rows for one org.
 *
 * Semantics:
 *   - installs > 0 only on day_index=0 (the acquisition-day install count)
 *   - spend_micros > 0 only on day_index=0 (acquisition spend)
 *   - revenue_micros is the INCREMENTAL revenue on that day_index
 * so summing across [0..D] gives cumulative D-day revenue.
 *
 * Curves:
 *   revenue(d) follows cumulative ARPU(d) = A * (1 - exp(-d/tau)); we emit
 *   incremental = cumulative(d) - cumulative(d-1).
 *
 * Special cases:
 *   - ~10% of campaigns are "early winner, late loser" (short tau, low A).
 *   - One channel on one specific date has spend ×5 with flat revenue (anomaly).
 */
export function buildCohortRows(
  rng: Rng,
  org: Org,
  campaigns: Campaign[],
  creatives: Creative[],
  apps: App[],
  startDate: Date,
  cohortDays: number,
  creativeCohortWindowDays: number,
): CohortRow[] {
  const out: CohortRow[] = [];
  const orgCampaigns = campaigns.filter((c) => c.org_id === org.id);
  const platformByApp = new Map(apps.map((a) => [a.id, a.platform] as const));
  const creativesByCampaign = new Map<string, Creative[]>();
  for (const cr of creatives) {
    if (cr.org_id !== org.id) continue;
    if (!creativesByCampaign.has(cr.campaign_id)) creativesByCampaign.set(cr.campaign_id, []);
    creativesByCampaign.get(cr.campaign_id)!.push(cr);
  }

  // Pick one campaign to hold the spend-spike anomaly, and the specific date.
  const anomalyCampaign = orgCampaigns[0]!;
  const anomalyDate = formatISO(addDays(startDate, Math.floor(cohortDays / 2)), {
    representation: "date",
  });

  for (const camp of orgCampaigns) {
    const platform = platformByApp.get(camp.app_id) ?? "web";
    const currency = org.base_currency;

    // Per-campaign shape params (deterministic from RNG).
    const isEarlyWinnerLateLoser = rng.next() < 0.1;
    const baseInstalls = rng.int(50, 500);
    const cpiUsd = 0.5 + rng.next() * 4.5; // $0.50..$5.00
    const A_usd = isEarlyWinnerLateLoser ? 0.2 + rng.next() * 0.4 : 1.0 + rng.next() * 4.0; // D90 ARPU
    const tau = isEarlyWinnerLateLoser ? 3 : 20 + rng.int(0, 30); // retention time-constant

    const topCreatives = (creativesByCampaign.get(camp.id) ?? []).slice(0, 2);

    for (let d = 0; d < cohortDays; d++) {
      const cohortDate = formatISO(addDays(startDate, d), { representation: "date" });
      const installs = Math.max(
        1,
        Math.round(baseInstalls * (1 + rng.normal() * 0.15)),
      );
      const isAnomaly = camp.id === anomalyCampaign.id && cohortDate === anomalyDate;
      const spendMultiplier = isAnomaly ? 5 : 1;
      const spendUsd = installs * cpiUsd * spendMultiplier;
      const spendMicros = BigInt(Math.round(spendUsd * 1_000_000));

      // Campaign-level rows for day_index 0..90.
      const perInstallCumPrev = new Array(91).fill(0) as number[];
      for (let di = 0; di <= 90; di++) {
        const cumRev = A_usd * (1 - Math.exp(-di / tau));
        perInstallCumPrev[di] = cumRev;
      }

      for (let di = 0; di <= 90; di++) {
        const incremental =
          di === 0 ? perInstallCumPrev[0]! : perInstallCumPrev[di]! - perInstallCumPrev[di - 1]!;
        const revenue = installs * incremental * (isAnomaly ? 0.2 : 1); // flat revenue during spike
        out.push({
          org_id: org.id,
          campaign_id: camp.id,
          creative_id: null,
          cohort_date: cohortDate,
          day_index: di,
          country: camp.country,
          platform,
          installs: di === 0 ? installs : 0,
          spend_micros: di === 0 ? spendMicros : 0n,
          revenue_micros: BigInt(Math.max(0, Math.round(revenue * 1_000_000))),
          currency,
        });
      }

      // Creative-level rows for the last `creativeCohortWindowDays` cohort dates.
      if (d >= cohortDays - creativeCohortWindowDays) {
        for (let ci = 0; ci < topCreatives.length; ci++) {
          const cr = topCreatives[ci]!;
          // Split installs/spend across top creatives (50/50 for 2 creatives).
          const share = 1 / topCreatives.length;
          const crInstalls = Math.max(1, Math.round(installs * share));
          const crSpend = BigInt(Math.round(Number(spendMicros) * share));
          // Give one creative a lift so creative-score has signal.
          const lift = ci === 0 ? 1.15 : 0.9;
          for (let di = 0; di <= 90; di++) {
            const incremental =
              di === 0
                ? perInstallCumPrev[0]!
                : perInstallCumPrev[di]! - perInstallCumPrev[di - 1]!;
            const revenue = crInstalls * incremental * lift * (isAnomaly ? 0.2 : 1);
            out.push({
              org_id: org.id,
              campaign_id: camp.id,
              creative_id: cr.id,
              cohort_date: cohortDate,
              day_index: di,
              country: camp.country,
              platform,
              installs: di === 0 ? crInstalls : 0,
              spend_micros: di === 0 ? crSpend : 0n,
              revenue_micros: BigInt(Math.max(0, Math.round(revenue * 1_000_000))),
              currency,
            });
          }
        }
      }
    }
  }
  return out;
}
