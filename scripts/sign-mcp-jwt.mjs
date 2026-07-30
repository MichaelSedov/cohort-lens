#!/usr/bin/env node
// Print the export lines needed to point pnpm mcp:dev / pnpm mcp:inspect at
// the local supabase stack, signed as a chosen seed user.
//
// Usage:
//   node scripts/sign-mcp-jwt.mjs                     # analyst@acme-games.test
//   node scripts/sign-mcp-jwt.mjs analyst@shared.test # cross-org user
//   eval "$(node scripts/sign-mcp-jwt.mjs)"           # apply to current shell

import { SignJWT } from "jose";
import { Client } from "pg";

const EMAIL = process.argv[2] ?? "analyst@acme-games.test";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
const user = await client.query(
  `select id from auth.users where email = $1 limit 1`, [EMAIL],
);
if (user.rows.length === 0) {
  console.error(`no such seed user: ${EMAIL}`);
  process.exit(1);
}
const userId = user.rows[0].id;
// Pick the first org this user belongs to. Cross-org callers can override
// COHORT_LENS_ORG_ID by hand to switch tenant.
const org = await client.query(
  `select o.id, o.name from org_members m join orgs o on o.id = m.org_id
   where m.user_id = $1 order by o.name limit 1`, [userId],
);
if (org.rows.length === 0) {
  console.error(`user ${EMAIL} is not a member of any org`);
  process.exit(1);
}
await client.end();

const now = Math.floor(Date.now() / 1000);
const jwt = await new SignJWT({ role: "authenticated" })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setSubject(userId)
  .setIssuedAt(now)
  .setExpirationTime(now + 12 * 3600)
  .setAudience("authenticated")
  .setIssuer("supabase-demo")
  .sign(new TextEncoder().encode(JWT_SECRET));

console.log(`# user=${EMAIL} org=${org.rows[0].name}`);
console.log(`export COHORT_LENS_URL="${SUPABASE_URL}/functions/v1"`);
console.log(`export COHORT_LENS_JWT="${jwt}"`);
console.log(`export COHORT_LENS_ORG_ID="${org.rows[0].id}"`);
