import { NextResponse } from "next/server";
import { liveFingerprint } from "@/lib/erp/packing-slips";

// Tiny change-fingerprint polled by every client. It's a GLOBAL value (not
// per-user), so we let the Vercel edge CACHE it for a few seconds: many devices
// polling within the same window collapse to ONE function invocation instead of
// one each. `s-maxage=8` matches the client poll cadence; stale-while-revalidate
// keeps it instant. This is the main cost lever — without it every device's poll
// was a separate function call + Neon query (millions/month).
const CACHE = "public, max-age=0, s-maxage=8, stale-while-revalidate=20";

export async function GET() {
  try {
    return NextResponse.json({ v: await liveFingerprint() }, { headers: { "Cache-Control": CACHE } });
  } catch {
    return NextResponse.json({ v: "" }, { headers: { "Cache-Control": CACHE } });
  }
}
