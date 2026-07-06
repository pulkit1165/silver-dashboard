import { NextResponse } from "next/server";
import { listPrinters } from "@/lib/erp/printnode";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";

export const dynamic = "force-dynamic";

// Lists the label printers PrintNode can see (one per ERP PC). The API key stays
// server-side; the client only ever sees printer ids/names.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "labels")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot print labels.` }, { status: 403 });
  }
  if (!process.env.PRINTNODE_API_KEY) {
    return NextResponse.json({ ok: false, error: "PrintNode not configured (missing PRINTNODE_API_KEY)." }, { status: 503 });
  }
  try {
    const printers = await listPrinters();
    // only real label printers (skip Microsoft/OneNote/Fax virtual ones)
    const label = printers.filter((p) => /tsc|ttp|zebra|godex|label/i.test(p.name));
    return NextResponse.json({ ok: true, printers: label.length ? label : printers });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
