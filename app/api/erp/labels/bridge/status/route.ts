import { NextResponse } from "next/server";
import { jobStatuses } from "@/lib/erp/printBridge";
import { getSessionUser } from "@/lib/erp/session";

export const dynamic = "force-dynamic";

// App → poll the status of enqueued bridge jobs (queued|printing|done|failed).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(b.ids) ? b.ids.map((x: unknown) => Number(x)).filter(Boolean) : [];
  return NextResponse.json({ ok: true, statuses: await jobStatuses(ids) });
}
