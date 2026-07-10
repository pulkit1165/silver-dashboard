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
  // "a4" = tile the exact-size labels across A4 pages with cut lines (a die
  // template / bulletproof exact-size print); default = one label per die-cut page.
  const sheet: "a4" | "die" = body.sheet === "a4" ? "a4" : "die";
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

  // Embed each unique QR once (copies of the same token reuse it).
  const qrCache = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();
  async function embedQr(token: string) {
    let img = qrCache.get(token);
    if (!img) {
      const png = await QRCode.toBuffer(token, { type: "png", margin: 2, width: 520, errorCorrectionLevel: "M" });
      img = await doc.embedPng(png);
      qrCache.set(token, img);
    }
    return img;
  }

  // ── A4 DIE SHEET: exact-size labels tiled on A4, with cut lines ─────────────
  if (sheet === "a4") {
    const A4W = 210 * MM, A4H = 297 * MM;
    const pageMargin = 8 * MM;
    const gutter = 3 * MM;
    const cellW = w * MM, cellH = h * MM;
    const usableW = A4W - 2 * pageMargin, usableH = A4H - 2 * pageMargin;
    const cols = Math.max(1, Math.floor((usableW + gutter) / (cellW + gutter)));
    const rows = Math.max(1, Math.floor((usableH + gutter) / (cellH + gutter)));
    const perPage = Math.max(1, cols * rows);
    const gridW = cols * cellW + (cols - 1) * gutter;
    const startX = pageMargin + Math.max(0, (usableW - gridW) / 2);
    const startTopY = A4H - pageMargin;
    const pad = 2 * MM;
    const qrMM2 = Math.min(h * 0.5, w * 0.42, 34);
    const qrPt2 = qrMM2 * MM;
    const skuSize = h >= 55 ? 11 : 9;
    const nameSize = h >= 55 ? 12 : 9.5;
    const qtySize = h >= 55 ? 9 : 7.5;
    const addr = ["SILVER IND. 50, OSWAL IND. COMPLEX", "G.T. ROAD, LUDHIANA-141010", "CUS.CARE silverup.ldh@gmail.com  PH.0161-5196409"];

    let page = doc.addPage([A4W, A4H]);
    for (let i = 0; i < labels.length; i++) {
      if (i > 0 && i % perPage === 0) page = doc.addPage([A4W, A4H]);
      const posInPage = i % perPage;
      const col = posInPage % cols, row = Math.floor(posInPage / cols);
      const x0 = startX + col * (cellW + gutter);
      const y0 = startTopY - row * (cellH + gutter) - cellH; // bottom-left of the cell
      const l = labels[i];

      // the die / cut outline
      page.drawRectangle({ x: x0, y: y0, width: cellW, height: cellH, borderColor: rgb(0.72, 0.72, 0.72), borderWidth: 0.5 });

      // QR on the left
      const qr = await embedQr(l.qrToken);
      const topY = y0 + cellH - pad;
      page.drawImage(qr, { x: x0 + pad, y: topY - qrPt2, width: qrPt2, height: qrPt2 });

      // right column: SKU, name (≤2 lines), qty/MRP
      const textX = x0 + pad + qrPt2 + 3 * MM;
      const textW = Math.max(10, x0 + cellW - pad - textX);
      const nameLines = wrap(l.name, bold, nameSize, textW).slice(0, 2);
      const qtyLine = (l.type === "master" ? `QTY: ${l.masterQty} ${l.unit}` : `Qty. ${l.singleQty || 1} ${l.unit}`)
        + ` · MRP.Rs.${Math.round(l.price)}/-`;
      let cy = topY;
      const gap = 2.5;
      const line = (text: string, f: typeof font, size: number) => {
        cy -= size; page.drawText(text, { x: textX, y: cy, size, font: f, color: rgb(0, 0, 0) }); cy -= gap;
      };
      line(l.sku_code, bold, skuSize);
      for (const nl of nameLines) line(nl, bold, nameSize);
      line(qtyLine, font, qtySize);

      // company address at the bottom (only where there's room)
      if (h >= 40) {
        let ay = y0 + pad + addr.length * 6;
        for (const al of addr) { ay -= 6; page.drawText(al, { x: x0 + pad, y: ay, size: 5, font, color: rgb(0.15, 0.15, 0.15) }); }
      }
    }

    const a4bytes = await doc.save();
    return new NextResponse(a4bytes as unknown as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="labels-a4-${w}x${h}.pdf"`,
      },
    });
  }

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
