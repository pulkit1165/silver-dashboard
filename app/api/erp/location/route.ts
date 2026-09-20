import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logDeviceLocation, listDeviceLocations, listLatestDeviceLocations, type LocationSource } from "@/lib/erp/deviceLocations";

export const dynamic = "force-dynamic";

const VALID_SOURCES: LocationSource[] = ["login", "scan", "ping"];

// Any signed-in user can log their own device's location — that's the point.
// Never gated behind a write permission; a denied/failed call must not block
// the login or scan it rides along with (the client already fires this off
// without awaiting it).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));

  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const source = VALID_SOURCES.includes(b.source) ? (b.source as LocationSource) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !source) {
    return NextResponse.json({ ok: false, error: "lat, lng and a valid source are required." }, { status: 400 });
  }

  await logDeviceLocation({
    userId: user.id, userName: user.name, role: user.role,
    deviceId: b.deviceId ? String(b.deviceId).slice(0, 64) : null,
    source, lat, lng, accuracy: b.accuracy != null ? Number(b.accuracy) : null,
  });
  return NextResponse.json({ ok: true });
}

// Viewing the fleet's location trail is admin-only — this is employee
// location data, not a routine operational read.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user, "device_locations")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot view device locations.` }, { status: 403 });
  }
  const [latest, recent] = await Promise.all([listLatestDeviceLocations(), listDeviceLocations(500)]);
  return NextResponse.json({ ok: true, latest, recent });
}
