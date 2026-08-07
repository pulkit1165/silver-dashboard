import "server-only";
import { randomBytes } from "crypto";
import { getSql } from "./db";

// Print-agent access tokens (like PrintNode "API keys"). Each PC/team installs the
// agent with a token; you can generate named tokens here and revoke any of them
// without touching the others. The legacy env PRINT_AGENT_TOKEN keeps working too.

export type AgentToken = {
  id: number; token: string; label: string; active: boolean;
  created_by: string | null; created_at: string;
  last_used_at: string | null; last_used_pc: string | null;
};

let ensured: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS agent_tokens (
        id bigserial PRIMARY KEY,
        token text UNIQUE NOT NULL,
        label text NOT NULL DEFAULT '',
        active boolean NOT NULL DEFAULT true,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz,
        last_used_pc text
      )`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export async function createToken(label: string, actor?: string | null): Promise<AgentToken> {
  await ensure();
  const token = "spat_" + randomBytes(24).toString("hex");
  const rows = (await getSql()`INSERT INTO agent_tokens (token, label, created_by)
    VALUES (${token}, ${String(label || "").slice(0, 60)}, ${actor ?? null}) RETURNING *`) as unknown as AgentToken[];
  tokenCache = null; // invalidate
  return rows[0];
}

export async function listTokens(): Promise<AgentToken[]> {
  try {
    await ensure();
    return (await getSql()`SELECT id, token, label, active, created_by, created_at, last_used_at, last_used_pc
      FROM agent_tokens ORDER BY created_at DESC`) as unknown as AgentToken[];
  } catch { return []; }
}

export async function setTokenActive(id: number, active: boolean): Promise<void> {
  await ensure();
  await getSql()`UPDATE agent_tokens SET active=${active} WHERE id=${id}`;
  tokenCache = null;
}
export async function deleteToken(id: number): Promise<void> {
  await ensure();
  await getSql()`DELETE FROM agent_tokens WHERE id=${id}`;
  tokenCache = null;
}

// ── validation (cached so the agent's frequent polls don't hammer the DB) ────
let tokenCache: { set: Set<string>; at: number } | null = null;
export async function isValidAgentToken(token: string): Promise<boolean> {
  if (!token) return false;
  const env = process.env.PRINT_AGENT_TOKEN;
  if (env && token === env) return true;
  const now = Date.now();
  if (!tokenCache || now - tokenCache.at > 60_000) {
    try {
      const rows = (await getSql()`SELECT token FROM agent_tokens WHERE active = true`) as unknown as { token: string }[];
      tokenCache = { set: new Set(rows.map((r) => r.token)), at: now };
    } catch { if (!tokenCache) tokenCache = { set: new Set(), at: now }; }
  }
  return tokenCache.set.has(token);
}

// Best-effort "last used" stamp (called from heartbeat, ~every 30s per agent).
export async function touchToken(token: string, pc: string): Promise<void> {
  const env = process.env.PRINT_AGENT_TOKEN;
  if (!token || token === env) return;
  try { await getSql()`UPDATE agent_tokens SET last_used_at=now(), last_used_pc=${pc} WHERE token=${token}`; } catch { /* ignore */ }
}

export async function agentAuthed(req: Request): Promise<boolean> {
  return isValidAgentToken(req.headers.get("x-agent-token") || "");
}
