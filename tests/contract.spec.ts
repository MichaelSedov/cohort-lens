import { beforeAll, describe, expect, it } from "vitest";
import { bff } from "./helpers/bff.ts";
import { findOrgIdByName, findUserIdByEmail, query } from "./helpers/db.ts";
import { signUserJwt } from "./helpers/jwt.ts";

let orgA_id: string;
let orgA_jwt: string;
let sampleCampaignId: string;

beforeAll(async () => {
  orgA_id = await findOrgIdByName("acme-games");
  orgA_jwt = await signUserJwt(await findUserIdByEmail("analyst@acme-games.test"));
  const rows = await query<{ id: string }>(
    `select id from campaigns where org_id = $1 limit 1`, [orgA_id],
  );
  sampleCampaignId = rows[0]!.id;
});

describe("BFF /cohort-performance", () => {
  it("happy path returns rows/totals/meta and Server-Timing", async () => {
    const res = await bff("cohort-performance", {
      jwt: orgA_jwt, orgId: orgA_id,
      body: {
        dateFrom: "2026-01-01", dateTo: "2026-03-31",
        dayIndex: 30, groupBy: ["channel", "country"],
        sort: { field: "spendUsd", dir: "desc" },
        page: { limit: 5, offset: 0 },
      },
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      rows: Array<{ key: object; installs: number; spendUsd: number; roas: number }>;
      totals: { installs: number; spendUsd: number; roas: number };
      meta: { rowCount: number; timezone: string; currency: string; queryMs: number };
    };
    expect(body.rows.length).toBeLessThanOrEqual(5);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows[0]!.spendUsd).toBeGreaterThanOrEqual(body.rows[body.rows.length - 1]!.spendUsd);
    expect(body.meta.currency).toBe("USD");
    expect(body.meta.timezone).toBe("America/Los_Angeles");
    expect(res.serverTiming).toMatch(/db;dur=\d+/);
    expect(res.serverTiming).toMatch(/total;dur=\d+/);
  });

  it("400 on bad zod input", async () => {
    const res = await bff("cohort-performance", {
      jwt: orgA_jwt, orgId: orgA_id,
      body: { dateFrom: "not-a-date", dateTo: "2026-03-31", groupBy: [] },
    });
    expect(res.status).toBe(400);
    const err = res.body as { error: { code: string } };
    expect(err.error.code).toBe("bad_request");
  });

  it("401 without an Authorization header", async () => {
    const res = await bff("cohort-performance", {
      orgId: orgA_id,
      body: { dateFrom: "2026-01-01", dateTo: "2026-01-02", groupBy: ["channel"] },
    });
    expect(res.status).toBe(401);
  });
});

describe("BFF /cohort-compare", () => {
  it("returns per-key deltas with a significance flag", async () => {
    const res = await bff("cohort-compare", {
      jwt: orgA_jwt, orgId: orgA_id,
      body: {
        periodA: { dateFrom: "2026-01-01", dateTo: "2026-01-31" },
        periodB: { dateFrom: "2026-02-01", dateTo: "2026-02-28" },
        dayIndex: 30, groupBy: ["channel"],
      },
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      rows: Array<{ key: object; a: object; b: object; delta: object; significance: string }>;
    };
    expect(body.rows.length).toBeGreaterThan(0);
    for (const r of body.rows) {
      expect(["ok", "low_volume"]).toContain(r.significance);
    }
  });
});

describe("BFF /creative-score", () => {
  it("returns per-creative components and a numeric score", async () => {
    const res = await bff("creative-score", {
      jwt: orgA_jwt, orgId: orgA_id,
      body: { campaignIds: [sampleCampaignId], dayIndex: 30, benchmarkWindowDays: 90 },
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      rows: Array<{ creativeId: string; score: number; components: object }>;
      benchmark: { window: string };
    };
    expect(body.benchmark.window).toBe("90d");
    expect(body.rows.length).toBeGreaterThan(0);
    for (const r of body.rows) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("BFF /campaigns", () => {
  it("cursor pagination returns items + nextCursor", async () => {
    const first = await bff("campaigns", {
      jwt: orgA_jwt, orgId: orgA_id, query: { limit: "5" },
    });
    expect(first.status).toBe(200);
    const b1 = first.body as { items: Array<{ id: string }>; pagination: { nextCursor: string | null; hasMore: boolean } };
    expect(b1.items.length).toBe(5);
    expect(b1.pagination.hasMore).toBe(true);
    expect(b1.pagination.nextCursor).toBeTruthy();

    const second = await bff("campaigns", {
      jwt: orgA_jwt, orgId: orgA_id,
      query: { limit: "5", cursor: b1.pagination.nextCursor! },
    });
    expect(second.status).toBe(200);
    const b2 = second.body as { items: Array<{ id: string }> };
    expect(b2.items[0]!.id > b1.items[b1.items.length - 1]!.id).toBe(true);
  });

  it("400 on bad query params", async () => {
    const res = await bff("campaigns", {
      jwt: orgA_jwt, orgId: orgA_id, query: { limit: "abc" },
    });
    expect(res.status).toBe(400);
  });
});
