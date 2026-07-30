import { Client } from "pg";
import { DATABASE_URL } from "./supabase.ts";

/** One-shot connect/query/close — fine for the test suite's tiny lookup traffic. */
export async function query<T = unknown>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query(sql, params);
    return r.rows as T[];
  } finally {
    await client.end();
  }
}

export async function findUserIdByEmail(email: string): Promise<string> {
  const rows = await query<{ id: string }>(
    `select id from auth.users where email = $1`,
    [email],
  );
  if (rows.length === 0) throw new Error(`user not found: ${email}`);
  return rows[0]!.id;
}

export async function findOrgIdByName(name: string): Promise<string> {
  const rows = await query<{ id: string }>(`select id from orgs where name = $1`, [name]);
  if (rows.length === 0) throw new Error(`org not found: ${name}`);
  return rows[0]!.id;
}
