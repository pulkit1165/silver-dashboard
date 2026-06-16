import { NextResponse } from "next/server";
import { isConfigured, runQuery } from "@/lib/oracle";

export const dynamic = "force-dynamic";

// Runs a single read-only SELECT. All write attempts are blocked in lib/oracle.
export async function POST(req: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Oracle not configured." }, { status: 503 });
  }
  let body: { sql?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.sql || typeof body.sql !== "string") {
    return NextResponse.json({ error: "Provide { sql: string }" }, { status: 400 });
  }
  try {
    const result = await runQuery(body.sql);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
