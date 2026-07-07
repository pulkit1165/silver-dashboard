import "server-only";

// PrintNode bridge: the dashboard (cloud) sends raw TSPL to the TSC label
// printers via PrintNode's API. A small PrintNode client runs on each ERP PC
// and delivers the raw commands straight to the printer — which is what finally
// got around Windows swallowing raw print data.

const API = "https://api.printnode.com";
function authHeader(): string {
  const key = process.env.PRINTNODE_API_KEY || "";
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

export type PnPrinter = {
  id: number; name: string; state: string;
  computer: string; computerId: number; computerState: string;
};

export async function listPrinters(): Promise<PnPrinter[]> {
  const r = await fetch(`${API}/printers`, { headers: { Authorization: authHeader() }, cache: "no-store" });
  if (!r.ok) throw new Error(`PrintNode /printers ${r.status}`);
  const d = (await r.json()) as Array<Record<string, unknown>>;
  return d.map((p) => {
    const comp = (p.computer ?? {}) as Record<string, unknown>;
    return {
      id: Number(p.id), name: String(p.name), state: String(p.state),
      computer: String(comp.name ?? ""), computerId: Number(comp.id ?? 0),
      computerState: String(comp.state ?? ""),
    };
  });
}

export type LabelData = {
  sku_code: string; qrToken: string; name: string; type: "single" | "master";
  masterQty: number; singleQty: number; unit: string; price: number;
  // lot/rack are kept in the data model for the future Lot No / Rack No menus,
  // but are deliberately NOT printed on the label for now.
  lot?: string; rack?: string; pkd?: string;
};

// ── TSPL builder ─────────────────────────────────────────────────────────
// 203 dpi = 8 dots/mm. Layout: a big QR on the left; on the right the SKU code,
// the full product name (up to 2 lines), and qty/MRP. No Single/Master tier
// line, no lot/rack. Everything sits in the TOP area so the label's pre-printed
// address (bottom ~38%) stays clear. DIRECTION 0 = right-side up on these rolls.
const F_WIDTH: Record<string, number> = { "1": 8, "2": 12, "3": 16, "4": 24, "5": 32 };
const F_HEIGHT: Record<string, number> = { "1": 12, "2": 20, "3": 24, "4": 32, "5": 48 };
function fitText(s: string, font: string, maxDots: number): string {
  const w = F_WIDTH[font] || 16;
  const max = Math.max(3, Math.floor(maxDots / w));
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + "." : s;
}
// TSPL TEXT has no auto-wrap, so word-wrap the name to at most `maxLines` lines.
function wrapText(s: string, font: string, maxDots: number, maxLines: number): string[] {
  const cw = F_WIDTH[font] || 16;
  const maxChars = Math.max(4, Math.floor(maxDots / cw));
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (test.length > maxChars && cur) {
      lines.push(cur); cur = word;
      if (lines.length >= maxLines) break;
    } else cur = test;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines).map((l) => (l.length > maxChars ? l.slice(0, maxChars) : l));
}
const esc = (s: unknown) => String(s ?? "").replace(/["\r\n]/g, " ").trim();

export function buildTSPL(l: LabelData, w: number, h: number): string {
  const dp = 8;
  const Wd = Math.round(w * dp), Hd = Math.round(h * dp);
  const pad = Math.round(2 * dp);
  const top = Math.round(Hd * 0.13);       // a little space at the top
  const bottom = Math.round(Hd * 0.66);    // content area; below = pre-printed address
  const qrX = Math.round(4 * dp);          // 4mm in from the left so the QR never clips
  const qrY = top;
  // Biggest QR that fits BOTH the content height and ~half the label width — so
  // it scales up on big labels. NOTE: TSPL QRCODE cell width maxes at 10; going
  // higher makes the printer silently drop the QR, so 10 is the hard cap.
  const qrByH = Math.floor((bottom - qrY) / 25);
  const qrByW = Math.floor((Wd * 0.5) / 25);
  const qrCell = Math.max(5, Math.min(10, qrByH, qrByW));
  const qrPx = qrCell * 25;
  const textX = qrX + qrPx + Math.round(3 * dp);
  const textW = Wd - textX - pad;

  // Fonts scale with label height so text is big on big labels.
  const big = h >= 60, med = h >= 45;
  const skuF = big ? "5" : med ? "4" : "3";
  const nameF = big ? "5" : med ? "4" : "3";
  const qtyF = big ? "4" : med ? "3" : "2";
  const lh = (f: string) => (F_HEIGHT[f] || 24) + Math.round(0.6 * dp);

  const qty = (l.type === "master" ? `QTY:${l.masterQty} ${l.unit}` : `Qty.${l.singleQty || 1} ${l.unit}`)
    + `  MRP.Rs.${Math.round(l.price)}/-`;
  const nameLines = wrapText(esc(l.name), nameF, textW, 2);

  let cy = top;
  const rows: string[] = [];
  rows.push(`TEXT ${textX},${cy},"${skuF}",0,1,1,"${fitText(esc(l.sku_code), skuF, textW)}"`); cy += lh(skuF);
  for (const nl of nameLines) { rows.push(`TEXT ${textX},${cy},"${nameF}",0,1,1,"${nl}"`); cy += lh(nameF); }
  rows.push(`TEXT ${textX},${cy},"${qtyF}",0,1,1,"${fitText(esc(qty), qtyF, textW)}"`);

  return [
    `SIZE ${w} mm, ${h} mm`,
    `GAP 3 mm, 0 mm`,
    // Lower density + slow speed = CRISP QR. At DENSITY 15 the fine QR modules
    // over-ink and bleed into each other, which is why a printed QR won't scan
    // even though the on-screen one does. ~9-10 keeps modules separated.
    `DENSITY 9`,
    `SPEED 2`,
    `DIRECTION 0`,
    `REFERENCE 0,0`,
    `CLS`,
    `QRCODE ${qrX},${qrY},M,${qrCell},A,0,"${esc(l.qrToken)}"`,
    ...rows,
    `PRINT 1,1`,
    ``,
  ].join("\r\n");
}

export async function printLabels(printerId: number, labels: LabelData[], w: number, h: number) {
  const out: Array<{ token: string; ok: boolean; job?: unknown; error?: string }> = [];
  for (const l of labels) {
    const tspl = buildTSPL(l, w, h);
    const body = {
      printerId,
      title: `Silver label ${l.qrToken}`,
      contentType: "raw_base64",
      content: Buffer.from(tspl, "ascii").toString("base64"),
      source: "silver-erp",
    };
    try {
      const r = await fetch(`${API}/printjobs`, {
        method: "POST",
        headers: { Authorization: authHeader(), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) out.push({ token: l.qrToken, ok: true, job: await r.json() });
      else out.push({ token: l.qrToken, ok: false, error: `${r.status} ${await r.text()}` });
    } catch (e) {
      out.push({ token: l.qrToken, ok: false, error: String(e) });
    }
  }
  return out;
}
