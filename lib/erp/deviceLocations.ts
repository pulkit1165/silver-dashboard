import "server-only";
import { getSql } from "./db";

/**
 * Best-effort location trail for company-issued phones/tablets, captured
 * client-side (see components/LocationPing.tsx and the pingLocation() calls
 * on login + every QR scan action) — never a hard requirement, just a log to
 * check later. Self-creating table (mirrors lib/erp/activity.ts) so this
 * works without a db:push; also declared in schema.ts for documentation.
 */
let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensured) {
    const sql = getSql();
    ensured = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS device_locations (
        id serial PRIMARY KEY,
        user_id integer,
        user_name text,
        role text,
        device_id text,
        source text NOT NULL,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        accuracy double precision,
        created_at text DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      )`;
      await sql`CREATE INDEX IF NOT EXISTS device_loc_user_idx ON device_locations (user_id, created_at)`;
      await sql`CREATE INDEX IF NOT EXISTS device_loc_device_idx ON device_locations (device_id, created_at)`;
    })().catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export type LocationSource = "login" | "scan" | "ping";

export interface LogLocationInput {
  userId: number | null;
  userName: string | null;
  role: string | null;
  deviceId: string | null;
  source: LocationSource;
  lat: number;
  lng: number;
  accuracy?: number | null;
}

/** Best-effort: a failed location log must never break login/scanning. */
export async function logDeviceLocation(input: LogLocationInput): Promise<void> {
  try {
    await ensureTable();
    await getSql()`
      INSERT INTO device_locations (user_id, user_name, role, device_id, source, lat, lng, accuracy)
      VALUES (${input.userId}, ${input.userName}, ${input.role}, ${input.deviceId}, ${input.source},
              ${input.lat}, ${input.lng}, ${input.accuracy ?? null})`;
  } catch { /* swallow — never block the action this rides along with */ }
}

export interface DeviceLocationRow {
  id: number; user_id: number | null; user_name: string | null; role: string | null;
  device_id: string | null; source: LocationSource; lat: number; lng: number;
  accuracy: number | null; created_at: string;
}

/** Recent raw log, newest first — the full trail. */
export async function listDeviceLocations(limit = 500): Promise<DeviceLocationRow[]> {
  try {
    await ensureTable();
    return (await getSql()`
      SELECT * FROM device_locations ORDER BY id DESC LIMIT ${limit}`) as unknown as DeviceLocationRow[];
  } catch { return []; }
}

/** One row per (user, device) — the "where is each phone right now" view. */
export async function listLatestDeviceLocations(): Promise<DeviceLocationRow[]> {
  try {
    await ensureTable();
    return (await getSql()`
      SELECT DISTINCT ON (user_id, device_id) *
      FROM device_locations
      ORDER BY user_id, device_id, id DESC`) as unknown as DeviceLocationRow[];
  } catch { return []; }
}
