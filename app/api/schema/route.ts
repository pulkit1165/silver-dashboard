import { NextResponse } from "next/server";
import { isConfigured, listTables } from "@/lib/oracle";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Oracle not configured. Set credentials in .env.local." },
      { status: 503 },
    );
  }
  try {
    const tables = await listTables();
    return NextResponse.json({ tables });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
