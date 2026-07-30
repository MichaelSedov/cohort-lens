import { beforeAll, describe, expect, it } from "vitest";
import { findOrgIdByName, findUserIdByEmail, query } from "./helpers/db.ts";
import { signUserJwt } from "./helpers/jwt.ts";
import { pgrest } from "./helpers/postgrest.ts";

// One-time lookups shared across cases.
let orgA_id: string;
let orgB_id: string;
let orgC_id: string;
let userA_jwt: string;
let userB_jwt: string;
let cross_jwt: string;

beforeAll(async () => {
  orgA_id = await findOrgIdByName("acme-games");
  orgB_id = await findOrgIdByName("northwind-apps");
  orgC_id = await findOrgIdByName("zenith-vpn");
  userA_jwt = await signUserJwt(await findUserIdByEmail("analyst@acme-games.test"));
  userB_jwt = await signUserJwt(await findUserIdByEmail("analyst@northwind-apps.test"));
  cross_jwt = await signUserJwt(await findUserIdByEmail("analyst@shared.test"));
});

describe("RLS: tenant isolation", () => {
  it("user of org A gets 0 rows from org B on a direct query", async () => {
    const res = await pgrest<Array<{ org_id: string }>>(
      `/cohort_daily?select=org_id&org_id=eq.${orgB_id}&limit=5`,
      { jwt: userA_jwt },
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual([]);
  });

  it("user of org A sees only org A rows when no filter is applied", async () => {
    const res = await pgrest<Array<{ org_id: string }>>(
      `/cohort_daily?select=org_id&limit=1000`,
      { jwt: userA_jwt },
    );
    expect(res.status).toBe(200);
    const uniqueOrgs = new Set((res.body as { org_id: string }[]).map((r) => r.org_id));
    expect([...uniqueOrgs]).toEqual([orgA_id]);
  });

  it("cross-org user sees exactly org A and org B (their memberships), never org C", async () => {
    // Use the tiny `orgs` table so the assertion is on the full row set rather
    // than a sample of a 2M-row heap ordered by physical insertion.
    const res = await pgrest<Array<{ id: string }>>(`/orgs?select=id`, { jwt: cross_jwt });
    expect(res.status).toBe(200);
    const seen = new Set((res.body as { id: string }[]).map((r) => r.id));
    expect([...seen].sort()).toEqual([orgA_id, orgB_id].sort());
    expect(seen.has(orgC_id)).toBe(false);

    // Also confirm the cross-org user can reach cohort_daily rows from BOTH orgs
    // (not just whichever comes first physically) by filtering explicitly.
    const [rowsA, rowsB, rowsC] = await Promise.all([
      pgrest<Array<{ org_id: string }>>(
        `/cohort_daily?select=org_id&org_id=eq.${orgA_id}&limit=1`,
        { jwt: cross_jwt },
      ),
      pgrest<Array<{ org_id: string }>>(
        `/cohort_daily?select=org_id&org_id=eq.${orgB_id}&limit=1`,
        { jwt: cross_jwt },
      ),
      pgrest<Array<{ org_id: string }>>(
        `/cohort_daily?select=org_id&org_id=eq.${orgC_id}&limit=1`,
        { jwt: cross_jwt },
      ),
    ]);
    expect((rowsA.body as unknown[]).length).toBe(1);
    expect((rowsB.body as unknown[]).length).toBe(1);
    expect((rowsC.body as unknown[]).length).toBe(0);
  });

  it("unauthenticated request (no apikey, no JWT) returns 401", async () => {
    const res = await pgrest(`/cohort_daily?select=org_id&limit=1`, { apikey: false });
    expect(res.status).toBe(401);
  });

  it("INSERT into another org's cohort_daily is rejected by RLS at the DB layer", async () => {
    // User A tries to insert a row tagged with org B — WITH CHECK on the write
    // policy must reject it.
    const camp = await query<{ id: string; app_id: string; country: string }>(
      `select id, app_id, country from campaigns where org_id = $1 limit 1`,
      [orgB_id],
    );
    const res = await pgrest(`/cohort_daily`, {
      method: "POST",
      jwt: userA_jwt,
      body: {
        org_id: orgB_id,
        campaign_id: camp[0]!.id,
        creative_id: null,
        cohort_date: "2026-01-01",
        day_index: 0,
        country: camp[0]!.country,
        platform: "ios",
        installs: 1,
        spend_micros: "1",
        revenue_micros: "0",
        currency: "USD",
      },
    });
    // PostgREST surfaces RLS check failures as 403 with code 42501.
    expect(res.status).toBe(403);
    const err = res.body as { code?: string; message?: string };
    expect(err.code === "42501" || /row-level security/i.test(err.message ?? "")).toBe(true);
  });

  it("every public table has RLS enabled (schema-wide safety net)", async () => {
    const rows = await query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace
          and relkind = 'r'
        order by relname`,
    );
    // Loud, per-table assertion so a failure names the offender.
    const disabled = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(disabled).toEqual([]);
    // Sanity: ensure we actually enumerated our tenant tables.
    const names = rows.map((r) => r.relname);
    for (const t of ["orgs", "org_members", "apps", "campaigns", "creatives", "cohort_daily", "fx_rates"]) {
      expect(names).toContain(t);
    }
  });
});
