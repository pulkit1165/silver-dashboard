import { NextResponse } from "next/server";
import { printLabels, listPrinters, type LabelData, type LayoutOpts } from "@/lib/erp/printnode";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getLabelLayouts } from "@/lib/erp/labelLayout";

export const dynamic = "force-dynamic";

// Prints labels to a TSC printer via PrintNode. Body:
// { printerId, w, h, labels: LabelData[] }  — one raw TSPL job per label.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot print labels.` }, { status: 403 });
  }
  if (!process.env.PRINTNODE_API_KEY) {
    return NextResponse.json({ ok: false, error: "PrintNode not configured (missing PRINTNODE_API_KEY)." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const printerId = Number(body.printerId);
  const w = Math.max(10, Number(body.w) || 70);
  const h = Math.max(10, Number(body.h) || 40);
  const labels: LabelData[] = Array.isArray(body.labels) ? body.labels : [];
  if (!printerId) return NextResponse.json({ ok: false, error: "No printer selected." }, { status: 400 });
  if (!labels.length) return NextResponse.json({ ok: false, error: "No labels to print." }, { status: 400 });

  const lay = (body.layout ?? {}) as Record<string, unknown>;
  // The SAVED alignment (offsets/elements/design) is AUTHORITATIVE from the database
  // — keyed by sizeId — so every PC prints the SAME thing regardless of what its
  // (possibly stale) browser cached. Only printer-specific settings (pos/dpi/density/
  // speed) come from the request. Falls back to the client layout if sizeId is absent.
  const sizeId = String(body.sizeId || "").trim();
  let dbLay: { offsetX?: number; offsetY?: number; qrMM?: number; elements?: Record<string, unknown>; design?: number } | null = null;
  if (sizeId) { try { dbLay = (await getLabelLayouts())[sizeId] ?? null; } catch { dbLay = null; } }
  const src = dbLay ?? { offsetX: Number(lay.offsetXmm) || 0, offsetY: Number(lay.offsetYmm) || 0, qrMM: Number(lay.qrMM) || 0, elements: (lay.elements as Record<string, unknown>) || undefined, design: Number(lay.design) === 2 ? 2 : 1 };

  // Resolution is AUTHORITATIVE from the printer's model name (300 dpi for the
  // TTP-345, 203 for the TTP-244s) so a stale client bundle can't send the wrong
  // dpi and squash the print. Falls back to any client-sent dpi if the lookup fails.
  let dpi = Number(lay.dpi) >= 280 ? Number(lay.dpi) : 203;
  try {
    const p = (await listPrinters()).find((x) => x.id === printerId);
    if (p) dpi = /34\d|300\s*dpi/i.test(p.name) ? 300 : 203;
  } catch { /* keep client/default dpi */ }

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
    ...(Number(lay.topMM) >= 0 && lay.topMM !== "" && lay.topMM != null ? { topMM: Number(lay.topMM) } : {}),
    ...(Number(lay.leftMM) >= 0 && lay.leftMM !== "" && lay.leftMM != null ? { leftMM: Number(lay.leftMM) } : {}),
  };
  const results = await printLabels(printerId, labels, w, h, opts);
  const sent = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: sent > 0, sent, total: results.length, results });
}
