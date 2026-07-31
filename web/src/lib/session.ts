// Session state helpers on top of Supabase Auth.
//
// The seed users all have password "password" (set by supabase/seed/seed.ts).
// The dev login dropdown lists them and calls signInWithPassword directly —
// no bespoke JWT signing in the browser (which would require shipping the
// signing secret to the client).

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** Hardcoded — deterministic from the seeder's fixed --seed 42. */
export const SEED_USERS = [
  { email: "analyst@acme-games.test",     label: "analyst @ acme-games" },
  { email: "analyst@northwind-apps.test", label: "analyst @ northwind-apps" },
  { email: "analyst@zenith-vpn.test",     label: "analyst @ zenith-vpn" },
  { email: "owner@acme-games.test",       label: "owner @ acme-games" },
  { email: "analyst@shared.test",         label: "cross-org (acme + northwind)" },
] as const;

export type Org = { id: string; name: string; reporting_timezone: string; base_currency: string };

export function useSession() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return { email, ready };
}

/** Attempt to sign in as a seed user with the well-known dev password. */
export async function loginAs(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password: "password" });
  if (error) throw error;
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Fetch the orgs the current user belongs to. RLS on `orgs` scopes this to
 * memberships automatically — no need to filter on the client.
 */
export async function fetchOrgs(): Promise<Org[]> {
  const { data, error } = await supabase
    .from("orgs")
    .select("id, name, reporting_timezone, base_currency")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Org[];
}
