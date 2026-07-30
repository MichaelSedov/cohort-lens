import { z } from "npm:zod@3.23.8";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const uuid = z.string().uuid();

const GROUP_DIMS = ["channel", "country", "platform", "campaign", "creative"] as const;

const filters = z.object({
  channel:  z.array(z.enum(["meta", "tiktok", "google_ads", "asa", "snapchat"])).optional(),
  country:  z.array(z.string().length(2)).optional(),
  platform: z.array(z.enum(["ios", "android", "web"])).optional(),
}).partial().default({});

export const CohortPerformanceRequest = z.object({
  dateFrom: isoDate,
  dateTo:   isoDate,
  dayIndex: z.number().int().min(0).max(90).default(30),
  groupBy:  z.array(z.enum(GROUP_DIMS)).min(1).max(3),
  filters:  filters.optional().default({}),
  sort:     z.object({
    field: z.enum(["installs", "spendUsd", "revenueUsd", "roas"]).default("spendUsd"),
    dir:   z.enum(["asc", "desc"]).default("desc"),
  }).default({ field: "spendUsd", dir: "desc" }),
  page: z.object({
    limit:  z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  }).default({ limit: 100, offset: 0 }),
}).superRefine((v, ctx) => {
  const from = new Date(v.dateFrom).getTime();
  const to   = new Date(v.dateTo).getTime();
  if (to < from) ctx.addIssue({ code: "custom", message: "dateTo before dateFrom", path: ["dateTo"] });
  if ((to - from) / 86_400_000 > 400) {
    ctx.addIssue({ code: "custom", message: "date range exceeds 400 days", path: ["dateTo"] });
  }
});
export type CohortPerformanceRequestT = z.infer<typeof CohortPerformanceRequest>;

export const CohortCompareRequest = z.object({
  periodA: z.object({ dateFrom: isoDate, dateTo: isoDate }),
  periodB: z.object({ dateFrom: isoDate, dateTo: isoDate }),
  dayIndex: z.number().int().min(0).max(90).default(30),
  groupBy:  z.array(z.enum(GROUP_DIMS)).min(1).max(3),
  filters:  filters.optional().default({}),
});
export type CohortCompareRequestT = z.infer<typeof CohortCompareRequest>;

export const CreativeScoreRequest = z.object({
  campaignIds: z.array(uuid).optional(),
  creativeIds: z.array(uuid).optional(),
  dayIndex:    z.number().int().min(0).max(90).default(30),
  benchmarkWindowDays: z.number().int().min(1).max(365).default(14),
}).refine((v) => (v.campaignIds?.length ?? 0) + (v.creativeIds?.length ?? 0) > 0, {
  message: "provide at least one of campaignIds or creativeIds",
  path: ["campaignIds"],
});
export type CreativeScoreRequestT = z.infer<typeof CreativeScoreRequest>;

export const CampaignsQuery = z.object({
  limit:   z.coerce.number().int().min(1).max(500).default(100),
  cursor:  z.string().uuid().optional(),
  channel: z.enum(["meta", "tiktok", "google_ads", "asa", "snapchat"]).optional(),
  country: z.string().length(2).optional(),
});
export type CampaignsQueryT = z.infer<typeof CampaignsQuery>;
