// -----------------------------------------------------------------------------
// FAKE Meta Ads connector — DELIBERATELY not a real integration.
// -----------------------------------------------------------------------------
// This module demonstrates the *shape* of a production ingest pipeline:
//   * exponential backoff with full jitter for transient failures
//   * token-bucket rate limiting to respect a hypothetical 50 req/s quota
//   * idempotent upsert into cohort_daily using the natural key
//
// It does NOT talk to graph.facebook.com. `FakeInsightsApi` mimics a flaky
// remote by throwing on a configurable ratio of calls. Kept in bench/ (not in
// the BFF path) so it's obvious this is a demo, not a live connector.
// -----------------------------------------------------------------------------

import type { Client } from "pg";

// ---------- exponential backoff with full jitter ----------------------------

export type BackoffOpts = {
  maxAttempts: number;
  baseMs: number;
  capMs: number;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
  /** Injectable for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
};

export async function retry<T>(fn: () => Promise<T>, opts: BackoffOpts): Promise<T> {
  const rand = opts.random ?? Math.random;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === opts.maxAttempts - 1) break;
      // Full-jitter: sleep in [0, min(cap, base * 2^attempt))
      const window = Math.min(opts.capMs, opts.baseMs * 2 ** attempt);
      await sleep(rand() * window);
    }
  }
  throw lastErr;
}

// ---------- token bucket rate limiter ---------------------------------------

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(
    readonly capacity: number,
    readonly refillPerSec: number,
    readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }
  /** Blocks until 1 token is available, then consumes it. */
  async take(sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const needed = 1 - this.tokens;
      const waitMs = Math.ceil((needed / this.refillPerSec) * 1000);
      await sleep(waitMs);
    }
  }
  private refill() {
    const now = this.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefill = now;
  }
}

// ---------- fake remote API --------------------------------------------------

export type InsightRow = {
  orgId: string;
  campaignId: string;
  creativeId: string | null;
  cohortDate: string; // ISO YYYY-MM-DD
  dayIndex: number;
  country: string;
  platform: "ios" | "android" | "web";
  installs: number;
  spendMicros: bigint;
  revenueMicros: bigint;
  currency: string;
};

export class FakeInsightsApi {
  private callCount = 0;
  constructor(
    /** Ratio of calls that raise a transient error. */
    private readonly errorRate = 0.3,
    private readonly random: () => number = Math.random,
  ) {}
  get calls(): number { return this.callCount; }

  async getInsights(seedRow: InsightRow, count: number): Promise<InsightRow[]> {
    this.callCount += 1;
    if (this.random() < this.errorRate) {
      throw new Error("upstream 503 (fake): transient upstream failure");
    }
    // Return `count` variations of the seed row over consecutive day_index
    // values. Real Meta insights would give day-level breakdowns like this.
    const rows: InsightRow[] = [];
    for (let i = 0; i < count; i++) {
      rows.push({ ...seedRow, dayIndex: seedRow.dayIndex + i });
    }
    return rows;
  }
}

// ---------- upsert (idempotent) ---------------------------------------------

/**
 * ON CONFLICT on the natural-key UNIQUE constraint. Because it uses
 * `NULLS NOT DISTINCT`, campaign-level rows (creative_id IS NULL) also
 * deduplicate correctly — a re-run with the same data leaves counts stable.
 */
export async function upsertInsights(client: Client, rows: InsightRow[]): Promise<{ upserted: number }> {
  if (rows.length === 0) return { upserted: 0 };
  const values: unknown[] = [];
  const placeholders: string[] = [];
  rows.forEach((r, i) => {
    const b = i * 11;
    placeholders.push(
      `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9}::bigint,$${b+10}::bigint,$${b+11})`,
    );
    values.push(
      r.orgId, r.campaignId, r.creativeId, r.cohortDate, r.dayIndex,
      r.country, r.platform, r.installs, r.spendMicros.toString(),
      r.revenueMicros.toString(), r.currency,
    );
  });
  const sql = `
    insert into cohort_daily
      (org_id, campaign_id, creative_id, cohort_date, day_index,
       country, platform, installs, spend_micros, revenue_micros, currency)
    values ${placeholders.join(",")}
    on conflict on constraint cohort_daily_natural_key
    do update set
      installs       = excluded.installs,
      spend_micros   = excluded.spend_micros,
      revenue_micros = excluded.revenue_micros,
      currency       = excluded.currency
  `;
  const res = await client.query(sql, values);
  return { upserted: res.rowCount ?? 0 };
}

// ---------- ingest orchestration --------------------------------------------

export type IngestOpts = {
  api: FakeInsightsApi;
  limiter: TokenBucket;
  client: Client;
  seedRow: InsightRow;
  batches: number;
  rowsPerBatch: number;
  backoff?: Omit<BackoffOpts, "maxAttempts"> & { maxAttempts?: number };
};

export async function ingest(opts: IngestOpts): Promise<{ upserted: number; apiCalls: number }> {
  let upserted = 0;
  for (let b = 0; b < opts.batches; b++) {
    await opts.limiter.take(opts.backoff?.sleep);
    const rows = await retry(
      () => opts.api.getInsights(opts.seedRow, opts.rowsPerBatch),
      {
        maxAttempts: opts.backoff?.maxAttempts ?? 5,
        baseMs: opts.backoff?.baseMs ?? 20,
        capMs: opts.backoff?.capMs ?? 2000,
        ...(opts.backoff?.random ? { random: opts.backoff.random } : {}),
        ...(opts.backoff?.sleep ? { sleep: opts.backoff.sleep } : {}),
      },
    );
    const { upserted: n } = await upsertInsights(opts.client, rows);
    upserted += n;
  }
  return { upserted, apiCalls: opts.api.calls };
}
