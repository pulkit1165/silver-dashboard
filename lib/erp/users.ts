import "server-only";
import { getSql } from "./db";
import { hashPassword } from "./auth";
import { ROLES, type Role } from "./rbac";

export type ManagedUser = {
  id: number; name: string; username: string | null; email: string | null;
  role: Role; active: boolean; hasPassword: boolean;
};

const clean = (v: unknown, max = 80) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
const isRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r);
// A username is a short login id: letters/digits/._- , 2–40 chars, stored lower-case.
const normUsername = (v: unknown) => clean(v, 40).toLowerCase();
const validUsername = (u: string) => /^[a-z0-9._-]{2,40}$/.test(u);

export async function listAllUsers(): Promise<ManagedUser[]> {
  const rows = (await getSql()`
    SELECT id, name, username, email, role, COALESCE(active,true) AS active,
           (password_hash IS NOT NULL AND password_hash <> '') AS has_password
    FROM users ORDER BY id`) as unknown as
    Array<{ id: number; name: string; username: string | null; email: string | null; role: string; active: boolean; has_password: boolean }>;
  return rows.map((r) => ({ id: r.id, name: r.name, username: r.username, email: r.email, role: (r.role as Role), active: !!r.active, hasPassword: !!r.has_password }));
}

export type CreateUserInput = { name: string; username: string; password: string; role: string; email?: string | null; active?: boolean };

export async function createUser(input: CreateUserInput): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const name = clean(input.name);
  const username = normUsername(input.username);
  const role = clean(input.role, 20);
  const email = input.email ? clean(input.email, 120).toLowerCase() : null;
  const password = String(input.password ?? "");
  if (!name) return { ok: false, error: "Name is required." };
  if (!validUsername(username)) return { ok: false, error: "Username must be 2–40 chars: letters, digits, dot, dash or underscore." };
  if (!isRole(role)) return { ok: false, error: "Pick a valid role." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  const sql = getSql();
  // Pre-check for a friendly message (the unique index is the real guard against races).
  const [dupU] = (await sql`SELECT id FROM users WHERE lower(username)=${username}`) as unknown as Array<{ id: number }>;
  if (dupU) return { ok: false, error: `Username "${username}" is already taken.` };
  if (email) { const [dupE] = (await sql`SELECT id FROM users WHERE lower(email)=${email}`) as unknown as Array<{ id: number }>; if (dupE) return { ok: false, error: `Email "${email}" is already used.` }; }
  const hash = await hashPassword(password);
  try {
    const [row] = (await sql`
      INSERT INTO users (name, username, email, role, password_hash, active)
      VALUES (${name}, ${username}, ${email}, ${role}, ${hash}, ${input.active !== false})
      RETURNING id`) as unknown as Array<{ id: number }>;
    return { ok: true, id: row.id };
  } catch {
    return { ok: false, error: "Could not create the user (username or email may already exist)." };
  }
}

export type UpdateUserInput = { name?: string; username?: string; role?: string; email?: string | null; active?: boolean; password?: string };

export async function updateUser(id: number, input: UpdateUserInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const sql = getSql();
  const [existing] = (await sql`SELECT id FROM users WHERE id=${id}`) as unknown as Array<{ id: number }>;
  if (!existing) return { ok: false, error: "User not found." };

  const set: Record<string, unknown> = {};
  if (input.name != null) { const n = clean(input.name); if (!n) return { ok: false, error: "Name can't be blank." }; set.name = n; }
  if (input.username != null) {
    const u = normUsername(input.username);
    if (!validUsername(u)) return { ok: false, error: "Username must be 2–40 chars: letters, digits, dot, dash or underscore." };
    const [dup] = (await sql`SELECT id FROM users WHERE lower(username)=${u} AND id<>${id}`) as unknown as Array<{ id: number }>;
    if (dup) return { ok: false, error: `Username "${u}" is already taken.` };
    set.username = u;
  }
  if (input.role != null) { const r = clean(input.role, 20); if (!isRole(r)) return { ok: false, error: "Pick a valid role." }; set.role = r; }
  if (input.email !== undefined) {
    const e = input.email ? clean(input.email, 120).toLowerCase() : null;
    if (e) { const [dup] = (await sql`SELECT id FROM users WHERE lower(email)=${e} AND id<>${id}`) as unknown as Array<{ id: number }>; if (dup) return { ok: false, error: `Email "${e}" is already used.` }; }
    set.email = e;
  }
  if (input.active != null) set.active = !!input.active;
  if (input.password != null && input.password !== "") {
    if (String(input.password).length < 6) return { ok: false, error: "Password must be at least 6 characters." };
    set.password_hash = await hashPassword(String(input.password));
  }
  if (Object.keys(set).length === 0) return { ok: true };
  try {
    // Build a safe dynamic SET with postgres.js helpers.
    await sql`UPDATE users SET ${sql(set)} WHERE id=${id}`;
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update the user (username or email may already exist)." };
  }
}
