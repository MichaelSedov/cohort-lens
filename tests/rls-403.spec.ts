import { beforeAll, describe, expect, it } from "vitest";
import { bff } from "./helpers/bff.ts";
import { findOrgIdByName, findUserIdByEmail } from "./helpers/db.ts";
import { signUserJwt } from "./helpers/jwt.ts";

// The deferred phase-3 case: caller is authenticated for org A but supplies
// X-Org-Id for org B. The BFF must return 403 with a typed error envelope
// rather than a silent empty result — that's the point of having an app-layer
// check on top of RLS.

let orgB_id: string;
let userA_jwt: string;

beforeAll(async () => {
  orgB_id = await findOrgIdByName("northwind-apps");
  userA_jwt = await signUserJwt(await findUserIdByEmail("analyst@acme-games.test"));
});

describe("BFF: X-Org-Id validation (belt-and-braces vs RLS)", () => {
  it("returns 403 org_forbidden — not an empty 200 — when the header targets a non-member org", async () => {
    const res = await bff("cohort-performance", {
      jwt: userA_jwt,
      orgId: orgB_id,
      body: {
        dateFrom: "2026-01-01", dateTo: "2026-01-31",
        groupBy: ["channel"],
      },
    });
    expect(res.status).toBe(403);
    const err = res.body as { error: { code: string; message: string } };
    expect(err.error.code).toBe("org_forbidden");
  });

  it("returns 400 when X-Org-Id is missing entirely", async () => {
    const res = await bff("cohort-performance", {
      jwt: userA_jwt,
      body: { dateFrom: "2026-01-01", dateTo: "2026-01-31", groupBy: ["channel"] },
    });
    expect(res.status).toBe(400);
  });
});
