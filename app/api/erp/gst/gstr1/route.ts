import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { getGstr1Data } from "@/lib/erp/gstr1";

export const dynamic = "force-dynamic";

function toWorkbook(data: Awaited<ReturnType<typeof getGstr1Data>>) {
  const wb = XLSX.utils.book_new();

  const b2bRows: unknown[][] = [["GSTIN", "Invoice No", "Invoice Date", "Invoice Value", "POS", "Rate %", "Taxable Value", "IGST", "CGST", "SGST"]];
  for (const g of data.b2b) for (const inv of g.invoices) for (const it of inv.items)
    b2bRows.push([g.ctin, inv.inum, inv.idt, inv.val, inv.pos, it.rt, it.txval, it.iamt, it.camt, it.samt]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(b2bRows), "B2B");

  const b2clRows: unknown[][] = [["POS", "Invoice No", "Invoice Date", "Invoice Value", "Rate %", "Taxable Value", "IGST"]];
  for (const g of data.b2cl) for (const inv of g.invoices) for (const it of inv.items)
    b2clRows.push([g.pos, inv.inum, inv.idt, inv.val, it.rt, it.txval, it.iamt]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(b2clRows), "B2CL");

  const b2csRows: unknown[][] = [["POS", "Rate %", "Taxable Value", "IGST", "CGST", "SGST"]];
  for (const r of data.b2cs) b2csRows.push([r.pos, r.rt, r.txval, r.iamt, r.camt, r.samt]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(b2csRows), "B2CS");

  const hsnRows: unknown[][] = [["HSN", "UQC", "Qty", "Rate %", "Taxable Value", "IGST", "CGST", "SGST"]];
  for (const h of data.hsn) hsnRows.push([h.hsn, h.uqc, h.qty, h.rt, h.txval, h.iamt, h.camt, h.samt]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hsnRows), "HSN Summary");

  const docRows: unknown[][] = [
    ["Period from", "Period to", "Invoice count", "First invoice", "Last invoice"],
    [data.docSummary.from, data.docSummary.to, data.docSummary.count, data.docSummary.fromNo, data.docSummary.toNo],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(docRows), "Doc Summary");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user, "gst")) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot view GST reports.` }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from"); const to = sp.get("to");
  if (!from || !to) return NextResponse.json({ ok: false, error: "from and to (YYYY-MM-DD) are required." }, { status: 400 });

  const data = await getGstr1Data(from, to);
  const format = sp.get("format") ?? "preview";

  if (format === "preview") return NextResponse.json({ ok: true, data });

  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "gstr1.export", entity: "gstr1_run", entityId: `${from}_${to}`,
    summary: `Exported GSTR-1 (${format}) for ${from} to ${to} — ${data.summary.invoiceCount} invoice(s)`,
  });

  if (format === "json") {
    const body = JSON.stringify({ gstin: data.company.gstin, fp: from.slice(5, 7) + from.slice(0, 4), b2b: data.b2b, b2cl: data.b2cl, b2cs: data.b2cs, hsn: data.hsn }, null, 2);
    return new Response(body, {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="gstr1-${from}-to-${to}.json"` },
    });
  }
  if (format === "xlsx") {
    const buf = toWorkbook(data);
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="gstr1-${from}-to-${to}.xlsx"`,
      },
    });
  }
  return NextResponse.json({ ok: false, error: "format must be json, xlsx, or preview." }, { status: 400 });
}
