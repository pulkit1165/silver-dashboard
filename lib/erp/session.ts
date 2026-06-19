import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSql } from "./db";
import { verifySession, SESSION_COOKIE } from "./jwt";
import type { Role } from "./rbac";

export type CurrentUser = { id: number; name: string; role: Role; email: string };

/** The authenticated user, or null. (Use in layout/APIs that handle null themselves.) */
export async function getSessionUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  const [u] = await getSql()`SELECT id,name,role,email FROM users WHERE id=${payload.uid} AND active=true`;
  return (u as CurrentUser) ?? null;
}

/** Require auth in a page/server component — redirects to /login if not signed in. */
export async function getCurrentUser(): Promise<CurrentUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}

export async function listUsers(): Promise<CurrentUser[]> {
  return (await getSql()`SELECT id,name,role,email FROM users WHERE active=true ORDER BY id`) as unknown as CurrentUser[];
}
