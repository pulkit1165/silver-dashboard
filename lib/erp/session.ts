import "server-only";
import { cookies } from "next/headers";
import { getSql } from "./db";
import type { Role } from "./rbac";

export type CurrentUser = { id: number; name: string; role: Role; email: string };

export const SESSION_COOKIE = "erp_user_id";

/** Current signed-in user. Falls back to the seeded admin for first-run/demo. */
export async function getCurrentUser(): Promise<CurrentUser> {
  const sql = getSql();
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  const id = raw ? Number(raw) : NaN;
  let row: CurrentUser | undefined;
  if (!Number.isNaN(id)) {
    const [r] = await sql`SELECT id,name,role,email FROM users WHERE id=${id} AND active=true`;
    row = r as CurrentUser | undefined;
  }
  if (!row) {
    const [r] = await sql`SELECT id,name,role,email FROM users WHERE role='admin' ORDER BY id LIMIT 1`;
    row = r as CurrentUser;
  }
  return row;
}

export async function listUsers(): Promise<CurrentUser[]> {
  return (await getSql()`SELECT id,name,role,email FROM users WHERE active=true ORDER BY id`) as unknown as CurrentUser[];
}
