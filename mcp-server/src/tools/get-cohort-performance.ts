import { z } from "zod";
import type { BffClient } from "../client.ts";

// The description below is written for the LLM tool-picker. Keep it explicit
// about semantics (cohort-based, not calendar-based), units (USD), and the
// fact that pRoas is a *prediction* — the model should not present it as a
// measured value.
export const description = `Aggregate cohort-based ad performance for a date range and horizon (dayIndex).

WHEN TO USE:
  * Answering "what's my ROAS for X channel in the last N days" or similar.
  * The horizon is COHORT-BASED: dayIndex=30 means "sum revenue attributed to
    installs' first 30 days after install", NOT "revenue in the last 30 calendar
    days".

UNITS: money is USD (converted from source currency using fx_rates for the
cohort date). Do not add currency conversion on top.

GROUP BY: up to 3 dimensions from {channel, country, platform, campaign, creative}.
Prefer 1-2 dimensions unless the user asked for a deep breakdown.

pROAS is a PREDICTION, not a measurement — surface it as such ("predicted ROAS").

WORKED EXAMPLE:
  { "dateFrom":"2026-01-01","dateTo":"2026-03-31","dayIndex":30,
    "groupBy":["channel","country"], "filters":{"channel":["meta"]} }
  -> per-key installs / spendUsd / revenueUsd / roas / pRoas / cpi for meta
     campaigns from Q1 2026, using each cohort's first 30 days.`;

export const inputSchema = {
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayIndex: z.number().int().min(0).max(90).default(30),
  groupBy:  z.array(z.enum(["channel","country","platform","campaign","creative"])).min(1).max(3),
  filters:  z.object({
    channel:  z.array(z.enum(["meta","tiktok","google_ads","asa","snapchat"])).optional(),
    country:  z.array(z.string().length(2)).optional(),
    platform: z.array(z.enum(["ios","android","web"])).optional(),
  }).partial().optional(),
  sort: z.object({
    field: z.enum(["installs","spendUsd","revenueUsd","roas"]).default("spendUsd"),
    dir:   z.enum(["asc","desc"]).default("desc"),
  }).optional(),
  page: z.object({
    limit:  z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  }).optional(),
};

export async function execute(client: BffClient, input: unknown): Promise<unknown> {
  return client.postJson("cohort-performance", input);
}
