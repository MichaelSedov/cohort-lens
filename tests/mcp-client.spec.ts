// End-to-end test of the MCP server's HTTP client against the live BFF.
// We don't spawn the stdio MCP server here (that's a manual `pnpm mcp:inspect`
// verification per README). The client is the interesting integration piece —
// it forwards Authorization + X-Org-Id and normalises typed errors, and that
// path is exactly what the tools call at runtime.

import { beforeAll, describe, expect, it } from "vitest";
import { BffClient, BffError } from "../mcp-server/src/client.ts";
import { findOrgIdByName, findUserIdByEmail } from "./helpers/db.ts";
import { signUserJwt } from "./helpers/jwt.ts";
import { SUPABASE_URL } from "./helpers/supabase.ts";

let clientA: BffClient;
let clientCrossOrg: BffClient;
let orgB_id: string;

beforeAll(async () => {
  const orgA_id = await findOrgIdByName("acme-games");
  orgB_id = await findOrgIdByName("northwind-apps");
  const jwtA = await signUserJwt(await findUserIdByEmail("analyst@acme-games.test"));
  const url = `${SUPABASE_URL}/functions/v1`;
  clientA = new BffClient({ url, jwt: jwtA, orgId: orgA_id });
  // A user of org A trying to act as org B — should surface as BffError with
  // the exact code the BFF returned.
  clientCrossOrg = new BffClient({ url, jwt: jwtA, orgId: orgB_id });
});

describe("BffClient", () => {
  it("get() returns typed data with correct headers wired", async () => {
    const body = await clientA.get<{ items: unknown[]; pagination: { limit: number } }>(
      "campaigns", { limit: 3 },
    );
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeLessThanOrEqual(3);
    expect(body.pagination.limit).toBe(3);
  });

  it("postJson() reaches cohort-performance", async () => {
    const body = await clientA.postJson<{ rows: unknown[]; totals: object; meta: { currency: string } }>(
      "cohort-performance",
      {
        dateFrom: "2026-01-01", dateTo: "2026-01-31",
        groupBy: ["channel"], sort: { field: "spendUsd", dir: "desc" },
      },
    );
    expect(body.meta.currency).toBe("USD");
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("preserves the BFF's error code as BffError.code", async () => {
    await expect(
      clientCrossOrg.postJson("cohort-performance", {
        dateFrom: "2026-01-01", dateTo: "2026-01-31", groupBy: ["channel"],
      }),
    ).rejects.toMatchObject({ code: "org_forbidden", status: 403 });
  });

  it("bad_request on invalid body preserves the code too", async () => {
    try {
      await clientA.postJson("cohort-performance", { dateFrom: "nope", groupBy: [] });
      throw new Error("expected reject");
    } catch (err) {
      expect(err).toBeInstanceOf(BffError);
      expect((err as BffError).code).toBe("bad_request");
      expect((err as BffError).status).toBe(400);
    }
  });
});
