// Single source of truth for the API origins. In dev VITE_SUPABASE_URL is
// left unset and everything goes through Vite's proxy at :5173. In prod
// (Vercel) VITE_SUPABASE_URL points at the hosted Supabase project and
// requests go directly there over CORS.
//
// Env values pasted through Vercel's UI can carry stray whitespace, NBSP,
// zero-width chars, etc. — anything that survives becomes part of a fetch
// header and gets rejected as "Invalid value". clean() strips all of them.

const clean = (s: string | undefined | null): string =>
  (s ?? "")
    .toString()
    // strip zero-width chars, BOM, NBSP, and all standard whitespace
    .replace(/[​-‍﻿ \s]/g, "")
    .trim();

const envUrl = clean(import.meta.env.VITE_SUPABASE_URL);
const envKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

/** Origin used for /auth /rest /functions calls. */
export const SUPABASE_URL = envUrl.length > 0 ? envUrl : window.location.origin;

/** anon key — safe in the browser; RLS + Auth still enforce everything. */
export const SUPABASE_ANON_KEY =
  envKey.length > 0
    ? envKey
    // Local supabase default. Only works against the docker stack.
    : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// One-time debug log so a broken env value shows up in the console without
// leaking the full anon key. Safe to keep in prod — anon key isn't a secret.
if (typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.info(
    "[cohort-lens/env]",
    JSON.stringify({
      url: SUPABASE_URL,
      keyLen: SUPABASE_ANON_KEY.length,
      keyStart: SUPABASE_ANON_KEY.slice(0, 8),
      keyEnd: SUPABASE_ANON_KEY.slice(-8),
    }),
  );
}

/** Base for BFF calls — includes the /functions/v1 prefix. */
export const BFF_URL = `${SUPABASE_URL}/functions/v1`;
