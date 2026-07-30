import { SUPABASE_URL } from "./supabase.ts";

export type BffOpts = {
  jwt?: string;
  orgId?: string;
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string>;
};

export type BffResponse<T = unknown> = {
  status: number;
  body: T | { error?: { code: string; message: string; details?: unknown } };
  serverTiming: string | null;
};

export async function bff<T = unknown>(fn: string, opts: BffOpts = {}): Promise<BffResponse<T>> {
  const headers: Record<string, string> = {};
  if (opts.jwt) headers["Authorization"] = `Bearer ${opts.jwt}`;
  if (opts.orgId) headers["X-Org-Id"] = opts.orgId;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const url = new URL(`${SUPABASE_URL}/functions/v1/${fn}`);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = text.length > 0 ? JSON.parse(text) : null; } catch { /* keep text */ }
  return {
    status: res.status,
    body: body as T,
    serverTiming: res.headers.get("server-timing"),
  };
}
