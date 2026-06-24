import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { finalizeInvoice } from "@/lib/erp/invoices";

export const dynamic = "force-dynamic";

// Lock a draft: assign the next invoice number, advance so_lines.invoiced_qty so
// the same dispatched qty can never be billed twice.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "invoices")) {
    return NextResponse.json({ ok: false, error: `Your role (${user.role}) cannot finalize invoices.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const result = await finalizeInvoice(Number(id));
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "invoice.finalize", entity: "invoice", entityId: id,
    summary: `Finalized invoice ${result.invoiceNo}`,
  });
  return NextResponse.json({ ok: true, invoiceNo: result.invoiceNo });
}
