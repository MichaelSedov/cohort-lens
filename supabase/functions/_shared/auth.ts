import { clientForRequest } from "./db.ts";
import { errorResponse } from "./errors.ts";

export type AuthContext = {
  userId: string;
  orgId: string;
  orgTimezone: string;
  orgBaseCurrency: string;
};

/**
 * Enforce the X-Org-Id "braces" check on top of RLS's "belt". The BFF returns
 * an explicit 403 for a member of some other org — so the caller learns *why*
 * rather than seeing a silent empty result, which is impossible to debug from
 * the client side. RLS still independently prevents cross-org reads if this
 * check is ever bypassed.
 *
 * Returns either an `AuthContext` on success or a `Response` to short-circuit.
 */
export async function requireAuth(req: Request): Promise<AuthContext | Response> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.length < 20) {
    return errorResponse("unauthorized", "missing or malformed Authorization header");
  }
  const orgId = req.headers.get("X-Org-Id");
  if (!orgId) {
    return errorResponse("bad_request", "missing X-Org-Id header");
  }
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) {
    return errorResponse("bad_request", "X-Org-Id is not a uuid");
  }

  const sb = clientForRequest(req);

  // Fetch the org row. Because RLS scopes `orgs` to member-of, this returns
  // exactly one row iff the caller is a member of that org, and zero rows
  // otherwise — a single query proves both "authenticated" and "member".
  const { data, error } = await sb
    .from("orgs")
    .select("id, reporting_timezone, base_currency")
    .eq("id", orgId)
    .maybeSingle();

  if (error) {
    // A DB-side auth failure (bad JWT signature, expired token) surfaces here
    // as PostgREST 401. Anything else is 500.
    const status = (error as { status?: number }).status ?? 500;
    if (status === 401) return errorResponse("unauthorized", "invalid or expired JWT");
    return errorResponse("internal", "auth lookup failed", { pg: error.message });
  }
  if (!data) {
    return errorResponse("org_forbidden", "caller is not a member of the requested org");
  }

  // Extract sub from the JWT without verifying — signature was already verified
  // by PostgREST above. Payload is only used for logging/telemetry hooks.
  let userId = "unknown";
  try {
    const payload = JSON.parse(atob(auth.slice(7).split(".")[1] ?? ""));
    if (typeof payload.sub === "string") userId = payload.sub;
  } catch { /* ignore, non-fatal */ }

  return {
    userId,
    orgId: data.id,
    orgTimezone: data.reporting_timezone,
    orgBaseCurrency: data.base_currency,
  };
}
