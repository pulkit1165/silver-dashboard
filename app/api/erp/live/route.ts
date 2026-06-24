import { NextResponse } from "next/server";
import { liveFingerprint } from "@/lib/erp/packing-slips";

export const dynamic = "force-dynamic";

// Tiny change-fingerprint polled by every client; when it changes, clients refresh.
export async function GET() {
  try {
    return NextResponse.json({ v: await liveFingerprint() });
  } catch {
    return NextResponse.json({ v: "" });
  }
}
