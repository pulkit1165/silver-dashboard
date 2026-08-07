import { NextResponse } from "next/server";
import { buildTSPL, type LabelData, type LayoutOpts } from "@/lib/erp/printnode";
import { enqueueJobs } from "@/lib/erp/printBridge";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Enqueue labels to our OWN print bridge (self-hosted, replaces PrintNode). Body:
// { printerId: "PC::Printer Name", w, h, labels: LabelData[], layout }
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot print labels.` }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const printerId = String(body.printerId || "").trim();
  const w = Math.max(10, Number(body.w) || 70);
  const h = Math.max(10, Number(body.h) || 40);
  const labels: LabelData[] = Array.isArray(body.labels) ? body.labels : [];
  if (!printerId) return NextResponse.json({ ok: false, error: "No printer selected." }, { status: 400 });
  if (!labels.length) return NextResponse.json({ ok: false, error: "No labels to print." }, { status: 400 });

  const lay = (body.layout ?? {}) as Record<string, unknown>;
  // dpi is authoritative from the Windows printer NAME (300 for a TTP-345, else 203).
  const name = printerId.slice(printerId.indexOf("::") + 2);
  const dpi = /34\d|300\s*dpi/i.test(name) ? 300 : 203;

  const opts: LayoutOpts = {
    pos: lay.pos === "bottom" ? "bottom" : "top",
    large: !!lay.large,
    dpi,
    ...(Number(lay.density) >= 1 ? { density: Number(lay.density) } : {}),
    ...(Number(lay.speed) >= 1 ? { speed: Number(lay.speed) } : {}),
    ...(Number.isFinite(Number(lay.offsetXmm)) ? { offsetXmm: Number(lay.offsetXmm) } : {}),
    ...(Number.isFinite(Number(lay.offsetYmm)) ? { offsetYmm: Number(lay.offsetYmm) } : {}),
    ...(Number(lay.qrMM) > 0 ? { qrMM: Number(lay.qrMM) } : {}),
    ...(lay.elements && typeof lay.elements === "object" ? { elements: lay.elements as Record<string, { dx?: number; dy?: number; f?: number; sz?: number; mm?: number; b?: number }> } : {}),
  };

  const jobs = labels.map((l) => ({ title: `Silver label ${l.qrToken}`, tspl_b64: buildTSPL(l, w, h, opts).toString("base64") }));
  const ids = await enqueueJobs(printerId, jobs, user.name);
  return NextResponse.json({ ok: true, ids, queued: ids.length });
}
