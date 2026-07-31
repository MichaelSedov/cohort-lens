import { createClient } from "@supabase/supabase-js";

// Dev-only defaults matching what `supabase start` prints for the local stack.
// In prod these come from build-time envs (VITE_SUPABASE_URL / ANON_KEY).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

// Empty URL => use the Vite proxy (same-origin), so we go through :5173 which
// forwards /auth /rest /functions to :54321. Simpler for dev.
export const supabase = createClient(SUPABASE_URL || window.location.origin, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "cohort-lens.session",
  },
});
