import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { listRecentJobs, listBridgePrinters, queueCounts, retryJob, cancelJob, cancelAllQueued } from "@/lib/erp/printBridge";

export const dynamic = "force-dynamic";

// Live print-queue snapshot: recent jobs + online agents/printers + counts.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const [jobs, printers, counts] = await Promise.all([listRecentJobs(60), listBridgePrinters(), queueCounts()]);
  return NextResponse.json({ ok: true, jobs, printers, counts });
}

// Retry a failed / stuck job.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || "retry");
  if (action === "cancel-all") { const n = await cancelAllQueued(); return NextResponse.json({ ok: true, canceled: n }); }
  const id = Number(b.id);
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  if (action === "cancel") await cancelJob(id);
  else await retryJob(id);
  return NextResponse.json({ ok: true });
}
