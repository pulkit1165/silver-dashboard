import { NextResponse } from "next/server";
import { isConfigured, ping } from "@/lib/oracle";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({
      configured: false,
      ok: false,
      message: "No Oracle credentials configured. Set them in .env.local.",
    });
  }
  const r = await ping();
  return NextResponse.json({ configured: true, ...r });
}
