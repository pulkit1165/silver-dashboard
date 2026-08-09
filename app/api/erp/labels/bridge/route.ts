import { NextResponse } from "next/server";
import { buildTSPL, type LabelData, type LayoutOpts } from "@/lib/erp/printnode";
import { enqueueJobs } from "@/lib/erp/printBridge";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getLabelLayouts } from "@/lib/erp/labelLayout";

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
  // The SAVED alignment (offsets/elements/design) is AUTHORITATIVE from the database
  // — keyed by sizeId — so EVERY PC prints the SAME label regardless of what its
  // (possibly stale) browser cached. Only printer settings (pos/dpi/density/speed)
  // come from the request. Falls back to the client layout if sizeId is missing.
  const sizeId = String(body.sizeId || "").trim();
  let dbLay: { offsetX?: number; offsetY?: number; qrMM?: number; elements?: Record<string, unknown>; design?: number } | null = null;
  if (sizeId) { try { dbLay = (await getLabelLayouts())[sizeId] ?? null; } catch { dbLay = null; } }
  const src = dbLay ?? { offsetX: Number(lay.offsetXmm) || 0, offsetY: Number(lay.offsetYmm) || 0, qrMM: Number(lay.qrMM) || 0, elements: (lay.elements as Record<string, unknown>) || undefined, design: Number(lay.design) === 2 ? 2 : 1 };
  // dpi is authoritative from the Windows printer NAME (300 for a TTP-345, else 203).
  const name = printerId.slice(printerId.indexOf("::") + 2);
  const dpi = /34\d|300\s*dpi/i.test(name) ? 300 : 203;

  const opts: LayoutOpts = {
    pos: lay.pos === "bottom" ? "bottom" : "top",
    large: !!lay.large,
    dpi,
    ...(Number(lay.density) >= 1 ? { density: Number(lay.density) } : {}),
    ...(Number(lay.speed) >= 1 ? { speed: Number(lay.speed) } : {}),
    ...(Number.isFinite(Number(src.offsetX)) ? { offsetXmm: Number(src.offsetX) } : {}),
    ...(Number.isFinite(Number(src.offsetY)) ? { offsetYmm: Number(src.offsetY) } : {}),
    ...(Number(src.qrMM) > 0 ? { qrMM: Number(src.qrMM) } : {}),
    ...(src.elements && typeof src.elements === "object" ? { elements: src.elements as Record<string, { dx?: number; dy?: number; f?: number; sz?: number; mm?: number; b?: number }> } : {}),
    ...(Number(src.design) === 2 ? { design: 2 } : {}),
  };

  const jobs = labels.map((l) => ({ title: `Silver label ${l.qrToken}`, tspl_b64: buildTSPL(l, w, h, opts).toString("base64") }));
  const ids = await enqueueJobs(printerId, jobs, user.name);
  return NextResponse.json({ ok: true, ids, queued: ids.length });
}
