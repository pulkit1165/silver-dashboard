import { NextResponse } from "next/server";
import { describeTable, isConfigured } from "@/lib/oracle";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ table: string }> },
) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Oracle not configured." }, { status: 503 });
  }
  const { table } = await ctx.params;
  try {
    const columns = await describeTable(table);
    return NextResponse.json({ table, columns });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
