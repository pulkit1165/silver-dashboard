import { NextResponse } from "next/server";
import { printLabels, type LabelData, type LayoutOpts } from "@/lib/erp/printnode";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

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
  const opts: LayoutOpts = {
    pos: lay.pos === "bottom" ? "bottom" : "top",
    large: !!lay.large,
    ...(Number(lay.qrMM) > 0 ? { qrMM: Number(lay.qrMM) } : {}),
    ...(Number(lay.topMM) >= 0 && lay.topMM !== "" && lay.topMM != null ? { topMM: Number(lay.topMM) } : {}),
    ...(Number(lay.leftMM) >= 0 && lay.leftMM !== "" && lay.leftMM != null ? { leftMM: Number(lay.leftMM) } : {}),
  };
  const results = await printLabels(printerId, labels, w, h, opts);
  const sent = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: sent > 0, sent, total: results.length, results });
}
