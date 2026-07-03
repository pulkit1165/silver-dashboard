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
  qrToken: string; name: string; type: "single" | "master";
  masterQty: number; singleQty: number; unit: string; price: number;
  lot: string; rack: string; pkd: string;
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
  const qrMM = w >= 70 ? 22 : w >= 55 ? 18 : 15;
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
    const qrPng = await QRCode.toBuffer(l.qrToken, { type: "png", margin: 1, width: 320 });
    const qr = await doc.embedPng(qrPng);

    const textX = margin + qrPt + 2.5 * MM;
    const textW = pageW - textX - margin;
    const tier = l.type === "master" ? "MASTER PACK" : "SINGLE PACK";
    const qtyLine = (l.type === "master" ? `QTY: ${l.masterQty} ${l.unit}` : `Qty. ${l.singleQty || 1} ${l.unit}`)
      + ` · MRP.Rs.${Math.round(l.price)}/-` + (l.type === "master" ? " E" : "");
    const metaLine = `Lot: ${l.lot || "—"}   Rack: ${l.rack || "—"}   PKD: ${l.pkd}`;

    // measure the text block height so we can top- or bottom-anchor it
    const nameSize = 9, tierSize = 6.5, qtySize = 8, metaSize = 6.5, gap = 2;
    const nameLines = wrap(l.name, bold, nameSize, textW);
    const blockH = tierSize + gap + nameLines.length * (nameSize + gap) + qtySize + gap + metaSize;
    const contentH = Math.max(qrPt + (preprinted ? 0 : 0) + 6, blockH);
    const topY = pos === "top" ? pageH - margin : margin + contentH;

    // QR on the left, top of the content block
    page.drawImage(qr, { x: margin, y: topY - qrPt, width: qrPt, height: qrPt });
    page.drawText(l.qrToken, { x: margin, y: topY - qrPt - 6, size: 5, font, color: rgb(0.35, 0.35, 0.35) });

    // details on the right, drawn downward from topY
    let cy = topY;
    const line = (text: string, f: typeof font, size: number) => {
      cy -= size; page.drawText(text, { x: textX, y: cy, size, font: f, color: rgb(0, 0, 0) }); cy -= gap;
    };
    line(tier, bold, tierSize);
    for (const nl of nameLines) line(nl, bold, nameSize);
    line(qtyLine, bold, qtySize);
    line(metaLine, font, metaSize);
  }

  const bytes = await doc.save();
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="labels-${w}x${h}.pdf"`,
    },
  });
}
