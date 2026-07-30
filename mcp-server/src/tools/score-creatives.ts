import { z } from "zod";
import type { BffClient } from "../client.ts";

export const description = `Score creatives 0-100 on a composite of pROAS, retention proxy, CPI, and spend.

WHEN TO USE:
  * "Which creatives should we scale in Germany?"
  * "Which creatives are the weakest in the last 14 days?"
  * Answering any "creative quality" or "which creative" question.

INPUTS:
  * campaignIds and/or creativeIds — at least one is required.
  * benchmarkWindowDays: how far back to compute the benchmark cohort against
    (default 14). The benchmark is derived from THIS window, never hardcoded.
  * dayIndex: cohort horizon for pROAS (same semantics as get_cohort_performance).

OUTPUT: each row has {creativeId, campaignId, score, components}. The components
object breaks the score into named parts (pRoas 0.45, retention 0.20, cpi 0.20,
spend 0.15) with the raw values — surface these when explaining WHY a creative
scored high or low. Never present the score alone without context.

pROAS is a PREDICTION, not a measurement.

WORKED EXAMPLE:
  { "campaignIds":["<uuid>"], "dayIndex":30, "benchmarkWindowDays":30 }
  -> ranked list of that campaign's creatives with a component breakdown.`;

export const inputSchema = {
  campaignIds: z.array(z.string().uuid()).optional(),
  creativeIds: z.array(z.string().uuid()).optional(),
  dayIndex:    z.number().int().min(0).max(90).default(30),
  benchmarkWindowDays: z.number().int().min(1).max(365).default(14),
};

export async function execute(client: BffClient, input: unknown): Promise<unknown> {
  return client.postJson("creative-score", input);
}
