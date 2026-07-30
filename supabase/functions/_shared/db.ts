import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * Build a Supabase client that forwards the caller's JWT so RLS is applied.
 * The BFF only ever uses the anon key + the caller's JWT — a privileged key
 * would bypass tenant isolation. If SUPABASE_URL or SUPABASE_ANON_KEY are
 * missing at runtime that's an operator error, not a user error, so we
 * throw loudly. See tests/no-service-role.spec.ts for the enforcing grep.
 */
export function clientForRequest(req: Request): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY missing");
  const auth = req.headers.get("Authorization") ?? "";
  return createClient(url, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Run `fn`, timing it, and return the result along with the elapsed ms. */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - t0) };
}
