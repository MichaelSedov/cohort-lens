import { z } from "zod";
import type { BffClient } from "../client.ts";

export const description = `Compare two cohort periods on the same dimensions and horizon.

WHEN TO USE:
  * "How did meta perform in Feb vs Jan?"
  * "Did the creative refresh in March move ROAS?"
  * Always for period-over-period questions — do NOT try to call
    get_cohort_performance twice and diff the numbers yourself; this tool
    computes both absolute and % deltas and flags low-volume noise.

Each row is tagged with significance="low_volume" when either period has fewer
than 100 installs — do not present a big % delta on a low_volume row as a real
trend. Prefer to say "not enough data" or drop the row.

UNITS: USD, cohort-based (dayIndex=30 means "through the cohort's 30th day
after install", same as get_cohort_performance).

WORKED EXAMPLE:
  { "periodA":{"dateFrom":"2026-01-01","dateTo":"2026-01-31"},
    "periodB":{"dateFrom":"2026-02-01","dateTo":"2026-02-28"},
    "dayIndex":30, "groupBy":["channel"] }`;

export const inputSchema = {
  periodA: z.object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  periodB: z.object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  dayIndex: z.number().int().min(0).max(90).default(30),
  groupBy:  z.array(z.enum(["channel","country","platform","campaign","creative"])).min(1).max(3),
  filters:  z.object({
    channel:  z.array(z.enum(["meta","tiktok","google_ads","asa","snapchat"])).optional(),
    country:  z.array(z.string().length(2)).optional(),
    platform: z.array(z.enum(["ios","android","web"])).optional(),
  }).partial().optional(),
};

export async function execute(client: BffClient, input: unknown): Promise<unknown> {
  return client.postJson("cohort-compare", input);
}
