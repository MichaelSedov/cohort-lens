import { SignJWT } from "jose";
import { JWT_SECRET } from "./supabase.ts";

const secret = new TextEncoder().encode(JWT_SECRET);

/** Signs a Supabase-shaped user JWT (HS256) for the given auth.users.id. */
export async function signUserJwt(userId: string, ttlSeconds = 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .setAudience("authenticated")
    .setIssuer("supabase-demo")
    .sign(secret);
}
