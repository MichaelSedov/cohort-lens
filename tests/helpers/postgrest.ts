import { ANON_KEY, SUPABASE_URL } from "./supabase.ts";

export type PostgrestOpts = {
  jwt?: string;
  /** Set to false to omit the apikey header (simulates a raw / unauthenticated call). */
  apikey?: string | false;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Ask PostgREST for row count in the Content-Range header. */
  countExact?: boolean;
};

export type PostgrestResponse<T> = {
  status: number;
  body: T | { message?: string; code?: string; details?: string };
  contentRange: string | null;
};

/** Minimal PostgREST fetch wrapper. Never throws on non-2xx — callers assert. */
export async function pgrest<T = unknown>(
  path: string,
  opts: PostgrestOpts = {},
): Promise<PostgrestResponse<T>> {
  const headers: Record<string, string> = {};
  if (opts.apikey !== false) headers["apikey"] = opts.apikey ?? ANON_KEY;
  if (opts.jwt) headers["Authorization"] = `Bearer ${opts.jwt}`;
  if (opts.countExact) headers["Prefer"] = "count=exact";
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    // leave as text (e.g., empty)
  }
  return {
    status: res.status,
    body: body as T,
    contentRange: res.headers.get("content-range"),
  };
}
