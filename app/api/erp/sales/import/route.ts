import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { parseOrderWorkbook } from "@/lib/erp/so-import";
import { decodeSalesRows } from "@/lib/erp/sales-decode";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { file_base64 } — parse an uploaded Excel/CSV sales order into a draft
// order (same shape as the photo decoder). No AI: pure parse + SKU matching.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot create sales orders.` }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const b64 = String(b.file_base64 ?? "").split(",").pop() ?? "";
  if (!b64) return NextResponse.json({ ok: false, error: "No file provided." }, { status: 400 });

  let buf: Buffer;
  try { buf = Buffer.from(b64, "base64"); } catch { return NextResponse.json({ ok: false, error: "Bad file data." }, { status: 400 }); }

  let parsed;
  try { parsed = parseOrderWorkbook(buf); } catch { return NextResponse.json({ ok: false, error: "Could not read that file — is it a valid Excel/CSV?" }, { status: 422 }); }
  if (parsed.rows.length === 0) {
    return NextResponse.json({ ok: false, error: "No order lines found. The file needs columns like Item Code, Description, Qty, Rate (a header row with those names)." }, { status: 422 });
  }
  const draft = await decodeSalesRows(parsed.rows, parsed.customerHint);
  return NextResponse.json({ ok: true, draft, matched: draft.lines.filter((l) => l.sku_id).length, total: draft.lines.length });
}
