import { NextResponse } from "next/server";
import { enqueueJobs } from "@/lib/erp/printBridge";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// Print an APPROVED image-based (Photoshop-style) label. The browser has already
// rendered the design to the exact printer bitmap (1bpp, bit0=black) and packed it;
// here we just wrap it in TSPL and enqueue one job per copy (so STOP can cancel the
// remainder). One bitmap == one SKU, so the "one SKU per printer" rule holds by
// construction; we still cap copies.
const MAX_COPIES = 1000;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot print labels.` }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const printerId = String(b.printerId || "").trim();
  const w = Math.max(10, Math.round(Number(b.w) || 0));
  const h = Math.max(10, Math.round(Number(b.h) || 0));
  const widthBytes = Math.round(Number(b.widthBytes) || 0);
  const heightDots = Math.round(Number(b.heightDots) || 0);
  const bytesB64 = String(b.bytesB64 || "");
  const copies = Math.max(1, Math.round(Number(b.copies) || 1));
  const skuCode = String(b.skuCode || "").trim();
  const density = Number(b.density) >= 1 && Number(b.density) <= 15 ? Math.round(Number(b.density)) : 10;

  if (!printerId) return NextResponse.json({ ok: false, error: "No printer selected." }, { status: 400 });
  if (!widthBytes || !heightDots || !bytesB64) return NextResponse.json({ ok: false, error: "Empty bitmap." }, { status: 400 });
  if (copies > MAX_COPIES) return NextResponse.json({ ok: false, error: `Too many copies: ${copies}. Max ${MAX_COPIES} at a time.` }, { status: 400 });

  // dpi authoritative from the printer name; speed capped to the head's real max.
  const name = printerId.slice(printerId.indexOf("::") + 2);
  const dpi = /\b34[5-9]\b|300\s*?dpi/i.test(name) ? 300 : 203;
  const hires = dpi >= 280;
  const speed = Number(b.speed) >= 1 ? Math.min(hires ? 6 : 4, Math.round(Number(b.speed))) : 2;

  const raw = Buffer.from(bytesB64, "base64");
  if (raw.length !== widthBytes * heightDots)
    return NextResponse.json({ ok: false, error: `Bitmap size mismatch (${raw.length} vs ${widthBytes * heightDots}).` }, { status: 400 });

  // Sanity: the bitmap must be rendered at THIS printer's dpi (right physical size).
  const dp = dpi === 203 ? 8 : dpi / 25.4;
  const expectH = Math.round(h * dp);
  if (Math.abs(heightDots - expectH) > Math.max(8, expectH * 0.08))
    return NextResponse.json({ ok: false, error: `Bitmap was rendered for a different resolution — reopen the designer and reprint.` }, { status: 400 });

  const header = Buffer.from(
    [`SIZE ${w} mm, ${h} mm`, `GAP 3 mm, 0 mm`, `DENSITY ${density}`, `SPEED ${speed}`,
     `DIRECTION 0`, `REFERENCE 0,0`, `CLS`, `BITMAP 0,0,${widthBytes},${heightDots},0,`].join("\r\n"),
    "ascii");
  const trailer = Buffer.from(`\r\nPRINT 1,1\r\n`, "ascii");
  const tspl_b64 = Buffer.concat([header, raw, trailer]).toString("base64");

  // One job per copy → the STOP button can cancel the remainder.
  const jobs = Array.from({ length: copies }, () => ({ title: `Design label ${skuCode || ""}`.trim(), tspl_b64 }));
  const ids = await enqueueJobs(printerId, jobs, user.name);

  logActivity({ actor: user.name, actorRole: user.role, action: "label.print.raster", entity: "label_design", entityId: skuCode || printerId, summary: `Printed ${ids.length} image label(s) · ${w}×${h} · ${skuCode}` });
  return NextResponse.json({ ok: true, queued: ids.length, ids });
}
