// Typed BFF client for the browser. Pulls the current JWT from the Supabase
// session on every call (auto-refreshes are handled by @supabase/supabase-js)
// and attaches X-Org-Id from the caller. Non-2xx responses that carry the
// BFF's error envelope raise a `BffError` with the code preserved.

import { supabase } from "./supabase";

export class BffError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details?: unknown) {
    super(message);
    this.name = "BffError";
  }
}

export type Perf = {
  rows: PerfRow[];
  totals: { installs: number; spendUsd: number; revenueUsd: number; roas: number };
  meta: { rowCount: number; timezone: string; currency: string; queryMs: number };
};
export type PerfRow = {
  key: Record<string, string>;
  installs: number;
  spendUsd: number;
  revenueUsd: number;
  roas: number;
  pRoas: number;
  cpi: number;
};
export type CohortPerformanceInput = {
  dateFrom: string;
  dateTo: string;
  dayIndex: number;
  groupBy: Array<"channel" | "country" | "platform" | "campaign" | "creative">;
  filters?: {
    channel?: Array<"meta" | "tiktok" | "google_ads" | "asa" | "snapchat">;
    country?: string[];
    platform?: Array<"ios" | "android" | "web">;
  };
  sort?: { field: "installs" | "spendUsd" | "revenueUsd" | "roas"; dir: "asc" | "desc" };
  page?: { limit: number; offset: number };
};

async function currentJwt(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function post<T>(fn: string, orgId: string, body: unknown): Promise<{ body: T; serverTiming: string | null }> {
  const jwt = await currentJwt();
  if (!jwt) throw new BffError("unauthorized", "no active session", 401);
  const res = await fetch(`/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      "X-Org-Id": orgId,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text.length > 0 ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const env = parsed as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new BffError(
      env?.error?.code ?? `http_${res.status}`,
      env?.error?.message ?? `BFF returned ${res.status}`,
      res.status,
      env?.error?.details,
    );
  }
  return { body: parsed as T, serverTiming: res.headers.get("server-timing") };
}

export const api = {
  cohortPerformance: (orgId: string, input: CohortPerformanceInput) =>
    post<Perf>("cohort-performance", orgId, input),
};
