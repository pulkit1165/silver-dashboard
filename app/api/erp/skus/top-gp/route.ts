import { NextResponse } from "next/server";
import { getTopGpSkus } from "@/lib/erp/gp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const skus = await getTopGpSkus(25, 20);
    return NextResponse.json({ ok: true, skus });
  } catch (e) {
    console.error("top-gp skus failed:", e);
    return NextResponse.json({ ok: true, skus: [] });
  }
}
