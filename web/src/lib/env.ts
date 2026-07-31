// Single source of truth for the API origins. In dev VITE_SUPABASE_URL is
// left unset and everything goes through Vite's proxy at :5173. In prod
// (Vercel) VITE_SUPABASE_URL points at the hosted Supabase project and
// requests go directly there over CORS.

const envUrl = import.meta.env.VITE_SUPABASE_URL?.toString().trim();

/** Origin used for /auth /rest /functions calls. */
export const SUPABASE_URL = envUrl && envUrl.length > 0 ? envUrl : window.location.origin;

/** anon key — safe in the browser; RLS + Auth still enforce everything. */
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.toString().trim();
export const SUPABASE_ANON_KEY =
  envKey && envKey.length > 0
    ? envKey
    // Local supabase default. Only works against the docker stack.
    : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

/** Base for BFF calls — includes the /functions/v1 prefix. */
export const BFF_URL = `${SUPABASE_URL}/functions/v1`;
