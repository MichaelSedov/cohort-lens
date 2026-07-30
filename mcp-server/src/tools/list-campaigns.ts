import { z } from "zod";
import type { BffClient } from "../client.ts";

export const description = `List campaigns visible to the caller (cursor-paginated).

WHEN TO USE:
  * Call this FIRST if the user names a campaign without providing an id, or
    asks a "which campaigns…" question — the other tools expect uuids, not
    human-readable names.
  * Use the returned ids as input to get_cohort_performance / compare_periods /
    score_creatives.

INPUTS: optional filters {channel, country}. Paginate via cursor (opaque).
Prefer a small limit (10-50) unless the user asked for the full list.

WORKED EXAMPLE:
  { "channel":"meta","country":"DE","limit":10 }
  -> up to 10 meta/DE campaigns with { id, name, external_id, ... }; use the
     id to feed score_creatives or the others.`;

export const inputSchema = {
  limit:   z.number().int().min(1).max(500).default(50),
  cursor:  z.string().uuid().optional(),
  channel: z.enum(["meta","tiktok","google_ads","asa","snapchat"]).optional(),
  country: z.string().length(2).optional(),
};

export async function execute(client: BffClient, input: unknown): Promise<unknown> {
  const src = (input ?? {}) as Record<string, unknown>;
  const q: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(src)) {
    if (v !== undefined && v !== null) q[k] = v as string | number;
  }
  return client.get("campaigns", q);
}
