import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { getOrderSheet } from "@/lib/erp/orderSheet";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const sheet = await getOrderSheet(Number(id));
  if (!sheet) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  return NextResponse.json({ ok: true, sheet });
}
