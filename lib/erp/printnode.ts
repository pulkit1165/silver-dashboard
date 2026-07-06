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
  qrToken: string; name: string; type: "single" | "master";
  masterQty: number; singleQty: number; unit: string; price: number;
  lot: string; rack: string; pkd: string;
};

// ── TSPL builder ─────────────────────────────────────────────────────────
// 203 dpi = 8 dots/mm. Layout mirrors the tuned 70×40 label: QR on the left,
// details on the right, all in the TOP area (bottom left blank for the label's
// pre-printed address). DIRECTION 0 = right-side up on these rolls.
const F_WIDTH: Record<string, number> = { "1": 8, "2": 12, "3": 16, "4": 24, "5": 32 };
function fitText(s: string, font: string, maxDots: number): string {
  const w = F_WIDTH[font] || 16;
  const max = Math.max(3, Math.floor(maxDots / w));
  return s.length > max ? s.slice(0, max) : s;
}
const esc = (s: unknown) => String(s ?? "").replace(/["\r\n]/g, " ").trim();

export function buildTSPL(l: LabelData, w: number, h: number): string {
  const dp = 8;
  const Wd = Math.round(w * dp), Hd = Math.round(h * dp);
  const pad = Math.round(2 * dp);
  const top = Math.round(Hd * 0.20);       // content starts ~20% down
  const bottom = Math.round(Hd * 0.62);    // ...ends ~62% (bottom 38% = pre-printed address)
  const ch = bottom - top;
  const qrX = Math.round(4 * dp);          // 4mm left margin so the QR isn't clipped
  const qrY = Math.round(Hd * 0.12);       // QR sits a touch higher so it can be bigger
  const qrCell = Math.max(4, Math.min(8, Math.floor((bottom - qrY) / 25))); // biggest QR that fits the blank area
  const qrPx = qrCell * 25;
  const textX = qrX + qrPx + Math.round(2 * dp);
  const textW = Wd - textX - pad;
  const mainF = h >= 55 ? "4" : "3";
  const metaF = h >= 55 ? "3" : "2";

  const tier = l.type === "master" ? "MASTER PACK" : "SINGLE PACK";
  const qty = (l.type === "master" ? `QTY: ${l.masterQty} ${l.unit}` : `Qty. ${l.singleQty || 1} ${l.unit}`)
    + `  MRP.Rs.${Math.round(l.price)}/-`;
  const meta = `Lot:${l.lot || "--"}  Rk:${l.rack || "--"}  PKD:${l.pkd}`;

  const yTier = top;
  const yName = top + Math.round(ch * 0.31);
  const yQty = top + Math.round(ch * 0.61);
  const yMeta = top + Math.round(ch * 0.88);

  return [
    `SIZE ${w} mm, ${h} mm`,
    `GAP 3 mm, 0 mm`,
    `DENSITY 15`,
    `SPEED 2`,
    `DIRECTION 0`,
    `REFERENCE 0,0`,
    `CLS`,
    `QRCODE ${qrX},${qrY},M,${qrCell},A,0,"${esc(l.qrToken)}"`,
    `TEXT ${textX},${yTier},"${metaF}",0,1,1,"${fitText(esc(tier), metaF, textW)}"`,
    `TEXT ${textX},${yName},"${mainF}",0,1,1,"${fitText(esc(l.name), mainF, textW)}"`,
    `TEXT ${textX},${yQty},"${mainF}",0,1,1,"${fitText(esc(qty), mainF, textW)}"`,
    `TEXT ${textX},${yMeta},"${metaF}",0,1,1,"${fitText(esc(meta), metaF, textW)}"`,
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
