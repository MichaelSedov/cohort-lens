// Typed error envelope shared across every endpoint.
//
// CORS: cross-origin browsers (dashboard on Vercel talking to a Supabase
// project on *.supabase.co) require these headers on both the actual
// response and the OPTIONS preflight. Kept permissive here — Supabase Auth
// still gates the actual data via the JWT + RLS.
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-org-id, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Server-Timing, content-range",
  "Access-Control-Max-Age": "86400",
};

/** Reply to an OPTIONS preflight. Call at the top of every Deno.serve handler. */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export type ErrCode =
  | "bad_request"
  | "unauthorized"
  | "org_forbidden"
  | "not_found"
  | "internal";

export type ErrorEnvelope = {
  error: { code: ErrCode; message: string; details?: unknown };
};

export const STATUS: Record<ErrCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  org_forbidden: 403,
  not_found: 404,
  internal: 500,
};

/** Build a JSON Response with correct status + Server-Timing header. */
export function respond(
  body: unknown,
  init: { status?: number; dbMs?: number; startedAt?: number } = {},
): Response {
  const totalMs = init.startedAt !== undefined ? Math.round(performance.now() - init.startedAt) : undefined;
  const timing: string[] = [];
  if (init.dbMs !== undefined) timing.push(`db;dur=${init.dbMs}`);
  if (totalMs !== undefined) timing.push(`total;dur=${totalMs}`);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...CORS_HEADERS,
  };
  if (timing.length > 0) headers["Server-Timing"] = timing.join(", ");
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

export function errorResponse(code: ErrCode, message: string, details?: unknown): Response {
  const body: ErrorEnvelope = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return respond(body, { status: STATUS[code] });
}
