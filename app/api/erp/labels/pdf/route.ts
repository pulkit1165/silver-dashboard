import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// One label per page, page sized to the exact die-cut (mm). A correctly-sized
// PDF prints far more reliably on a thermal printer than the browser's HTML
// print — open it and print "Actual size". No agent / no extra software.
const MM = 72 / 25.4; // mm -> PDF points

type PdfLabel = {
  sku_code: string; qrToken: string; name: string; type: "single" | "master";
  masterQty: number; singleQty: number; unit: string; price: number;
  lot?: string; rack?: string; pkd?: string; // kept for future Lot/Rack menus, not printed
};

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot print labels.` }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const labels: PdfLabel[] = Array.isArray(body.labels) ? body.labels : [];
  const w = Math.max(10, Number(body.w) || 70);
  const h = Math.max(10, Number(body.h) || 40);
  const preprinted = body.preprinted !== false;
  const pos: "top" | "bottom" = body.contentPos === "bottom" ? "bottom" : "top";
  if (!labels.length) return NextResponse.json({ ok: false, error: "No labels" }, { status: 400 });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageW = w * MM, pageH = h * MM;
  const margin = 2 * MM;
  // Bigger QR — fills much of the content height, capped so text still fits.
  const qrMM = Math.min(h * 0.5, w * 0.42, 34);
  const qrPt = qrMM * MM;

  // wrap text to a max width in points
  const wrap = (text: string, f: typeof font, size: number, maxW: number): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const test = cur ? cur + " " + word : word;
      if (f.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = word; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  for (const l of labels) {
    const page = doc.addPage([pageW, pageH]);
    // high-res PNG + quiet zone (margin 2) for a crisp, scannable QR
    const qrPng = await QRCode.toBuffer(l.qrToken, { type: "png", margin: 2, width: 520, errorCorrectionLevel: "M" });
    const qr = await doc.embedPng(qrPng);

    const textX = margin + qrPt + 3 * MM;
    const textW = pageW - textX - margin;
    const skuSize = h >= 55 ? 11 : 9;
    const nameSize = h >= 55 ? 12 : 9.5;
    const qtySize = h >= 55 ? 9 : 7.5;
    const gap = 2.5;
    const nameLines = wrap(l.name, bold, nameSize, textW).slice(0, 2);
    const qtyLine = (l.type === "master" ? `QTY: ${l.masterQty} ${l.unit}` : `Qty. ${l.singleQty || 1} ${l.unit}`)
      + ` · MRP.Rs.${Math.round(l.price)}/-`;

    // top-anchored (bottom left blank for the pre-printed address)
    const topY = pos === "top" ? pageH - margin : margin + qrPt + 6;
    // QR on the left
    page.drawImage(qr, { x: margin, y: topY - qrPt, width: qrPt, height: qrPt });
    // right column: SKU code, full name (≤2 lines), qty/MRP
    let cy = topY;
    const line = (text: string, f: typeof font, size: number) => {
      cy -= size; page.drawText(text, { x: textX, y: cy, size, font: f, color: rgb(0, 0, 0) }); cy -= gap;
    };
    line(l.sku_code, bold, skuSize);
    for (const nl of nameLines) line(nl, bold, nameSize);
    line(qtyLine, font, qtySize);
  }

  const bytes = await doc.save();
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="labels-${w}x${h}.pdf"`,
    },
  });
}
