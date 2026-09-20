import { NextResponse } from "next/server";
import { buildTSPL, type LabelData, type LayoutOpts } from "@/lib/erp/printnode";
import { enqueueJobs } from "@/lib/erp/printBridge";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getLabelLayouts, defaultDesignFor, enforcedDesignFor } from "@/lib/erp/labelLayout";
import { pricesByCode } from "@/lib/erp/queries";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

// Enqueue labels to our OWN print bridge (self-hosted, replaces PrintNode). Body:
// { printerId: "PC::Printer Name", w, h, labels: LabelData[], layout }
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user, "labels")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot print labels.` }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const printerId = String(body.printerId || "").trim();
  const w = Math.max(10, Number(body.w) || 70);
  const h = Math.max(10, Number(body.h) || 40);
  const allLabels: LabelData[] = Array.isArray(body.labels) ? body.labels : [];
  // Drop labels with a blank QR token (the encoder throws on empty) so one bad record
  // can't fail the whole batch.
  const labels = allLabels.filter((l) => String(l?.qrToken ?? "").trim());
  const skipped = allLabels.length - labels.length;
  if (!printerId) return NextResponse.json({ ok: false, error: "No printer selected." }, { status: 400 });
  if (!labels.length) return NextResponse.json({ ok: false, error: skipped ? `All ${skipped} label(s) had a missing QR token — nothing queued.` : "No labels to print." }, { status: 400 });

  // ── Safety brake (server-authoritative — the client also guards, but this is
  // the real gate) ─────────────────────────────────────────────────────────
  // One SKU per print run, and never more than MAX_PER_PRINT labels at once, so
  // one action can't dump thousands into a printer (the 28-Aug ~10k runaway).
  const MAX_PER_PRINT = 1000;
  const skuCount = new Set(labels.map((l) => String(l.sku_code || "").toUpperCase())).size;
  if (skuCount > 1) return NextResponse.json({ ok: false, error: `Only one SKU can be printed at a time on a printer (received ${skuCount}). Print each item separately.` }, { status: 400 });
  if (labels.length > MAX_PER_PRINT) return NextResponse.json({ ok: false, error: `Too many labels in one print: ${labels.length}. The maximum is ${MAX_PER_PRINT} at a time — reduce the copies and print again.` }, { status: 400 });

  const lay = (body.layout ?? {}) as Record<string, unknown>;
  // The SAVED alignment (offsets/elements/design) is AUTHORITATIVE from the database
  // — keyed by sizeId — so EVERY PC prints the SAME label regardless of what its
  // (possibly stale) browser cached. Only printer settings (pos/dpi/density/speed)
  // come from the request. Falls back to the client layout if sizeId is missing.
  const sizeId = String(body.sizeId || "").trim();
  let dbLay: { offsetX?: number; offsetY?: number; qrMM?: number; elements?: Record<string, unknown>; design?: number } | null = null;
  if (sizeId) { try { dbLay = (await getLabelLayouts())[sizeId] ?? null; } catch { dbLay = null; } }
  // On a DB miss, offsets/elements may fall back to the client but the DESIGN template
  // is a server fact (defaultDesignFor), never the browser — so a new PC / new printer
  // can't reset the red label to Design 1. defaultDesignFor("red-85x55") === 2.
  const src = dbLay ?? { offsetX: Number(lay.offsetXmm) || 0, offsetY: Number(lay.offsetYmm) || 0, qrMM: Number(lay.qrMM) || 0, elements: (lay.elements as Record<string, unknown>) || undefined, design: defaultDesignFor(sizeId) };
  // dpi is authoritative from the Windows printer NAME (300 for a TTP-345, else 203).
  const name = printerId.slice(printerId.indexOf("::") + 2);
  // Strict 300dpi detection (TTP-34x model or explicit "300 dpi") — a loose /34\d/ used
  // to false-match a serial/renamed printer and render a 203dpi printer at 300dpi.
  const dpi = /\b34[5-9]\b|300\s*?dpi/i.test(name) ? 300 : 203;

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
    ...((enforcedDesignFor(sizeId) ?? Number(src.design)) === 2 ? { design: 2 } : {}),
  };

  // MRP is AUTHORITATIVE from the DB at print time — override the browser's cached price
  // so an updated MRP always lands on the sticker.
  const fresh = await pricesByCode(labels.map((l) => l.sku_code)).catch(() => ({} as Record<string, number>));
  const priced = labels.map((l) => { const p = fresh[String(l.sku_code).toUpperCase()]; return p != null ? { ...l, price: p } : l; });
  // Build defensively: if a single label fails to render, drop it rather than throwing
  // the whole batch (belt-and-braces on top of the blank-token filter above).
  //
  // SPEED: N copies of one label are the SAME bitmap. Sending them as N separate
  // one-label jobs makes the printer set up a fresh document (gap-sense/backfeed +
  // spooler overhead) for every label — so on a big run it fills its buffer, stalls
  // 5-7s, and repeats (the M3P9SLE symptom). Instead we collapse identical labels
  // into ONE bitmap stamped n times via `PRINT 1,n` (chunked to CHUNK for STOP
  // granularity), exactly like the raster path — the head then streams continuously.
  const CHUNK = 200;
  const PRINT11 = Buffer.from("PRINT 1,1\r\n", "ascii"); // the fixed trailer every buildTSPL emits
  const groups = new Map<string, { token: string; body: Buffer; full: Buffer; batched: boolean; count: number }>();
  for (const l of priced) {
    let tspl: Buffer;
    try { tspl = buildTSPL(l, w, h, opts); } catch { continue; }
    const key = tspl.toString("base64");
    const g = groups.get(key);
    if (g) { g.count++; continue; }
    // Strip the trailing `PRINT 1,1` so we can re-stamp the copy count per chunk.
    const batched = tspl.length >= PRINT11.length && tspl.subarray(tspl.length - PRINT11.length).equals(PRINT11);
    const body = batched ? tspl.subarray(0, tspl.length - PRINT11.length) : tspl;
    groups.set(key, { token: String(l.qrToken), body, full: tspl, batched, count: 1 });
  }
  const jobs: { title: string; tspl_b64: string }[] = [];
  for (const g of groups.values()) {
    const title = `Silver label ${g.token}`;
    if (!g.batched) { // unexpected TSPL shape — fall back to one job per copy (safe)
      for (let i = 0; i < g.count; i++) jobs.push({ title, tspl_b64: g.full.toString("base64") });
      continue;
    }
    let remaining = g.count;
    while (remaining > 0) {
      const n = Math.min(CHUNK, remaining);
      const tspl = Buffer.concat([g.body, Buffer.from(`PRINT 1,${n}\r\n`, "ascii")]);
      jobs.push({ title, tspl_b64: tspl.toString("base64") });
      remaining -= n;
    }
  }
  const ids = await enqueueJobs(printerId, jobs, user.name);
  // Audit which template (design) + lock code produced this batch.
  const effDesign = (enforcedDesignFor(sizeId) ?? (Number(src.design) === 2 ? 2 : 1)) === 2 ? 2 : 1;
  const lockCode = (dbLay && "lockCode" in dbLay ? (dbLay as { lockCode?: string | null }).lockCode : null) ?? null;
  if (ids.length) logActivity({
    actor: user.name, actorRole: user.role, action: "label.print.tspl", entity: "label_layout", entityId: sizeId,
    summary: `Queued ${labels.length} label(s) in ${ids.length} job(s) · ${w}×${h} · Design ${effDesign}${lockCode ? ` · ${lockCode}` : " · unlocked"}`,
    meta: { sizeId, design: effDesign, lockCode, labels: labels.length, jobs: ids.length, engine: "bridge" },
  }).catch(() => {});
  // `queued` = labels printed (what the operator counts); `jobs` = bridge jobs enqueued.
  return NextResponse.json({ ok: true, ids, queued: labels.length, jobs: ids.length, skipped });
}
