import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import {
  createQuotation, addLine, deleteLine, addQuote, deleteQuote, selectQuote,
  submitForApproval, decideQuotation, generatePOsFromIndent,
} from "@/lib/erp/purchaseQuotations";

export const dynamic = "force-dynamic";
const num = (v: unknown) => Number(v) || 0;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || "");
  const canPurchase = canWrite(user, "purchase");
  const isAdmin = user.role === "admin";

  try {
    switch (action) {
      case "create": {
        if (!canPurchase) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
        const r = await createQuotation({ department: String(b.department || ""), title: String(b.title || ""), createdBy: user.name });
        await logActivity({ actor: user.name, actorRole: user.role, action: "quotation.create", entity: "quotation", entityId: r.id, summary: `Raised quotation ${r.quoNo}${b.department ? ` for ${b.department}` : ""}` });
        return NextResponse.json({ ok: true, ...r });
      }
      case "addLine":
        if (!canPurchase) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
        await addLine(num(b.quotationId), { skuId: b.skuId ? num(b.skuId) : null, itemName: String(b.itemName || ""), qty: num(b.qty), uom: String(b.uom || "PCS") });
        return NextResponse.json({ ok: true });
      case "deleteLine":
        if (!canPurchase) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
        await deleteLine(num(b.lineId));
        return NextResponse.json({ ok: true });
      case "addQuote":
        if (!canPurchase) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
        if (!num(b.vendorId)) return NextResponse.json({ ok: false, error: "Pick a vendor." }, { status: 400 });
        await addQuote(num(b.lineId), { vendorId: num(b.vendorId), unitPrice: num(b.unitPrice), creditDays: num(b.creditDays), leadDays: num(b.leadDays), moq: num(b.moq), note: String(b.note || "") });
        return NextResponse.json({ ok: true });
      case "deleteQuote":
        if (!canPurchase) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
        await deleteQuote(num(b.quoteId));
        return NextResponse.json({ ok: true });
      case "select":
        if (!canPurchase) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
        await selectQuote(num(b.lineId), num(b.quoteId));
        return NextResponse.json({ ok: true });
      case "submit": {
        if (!canPurchase) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
        const r = await submitForApproval(num(b.quotationId));
        if (!r.ok) return NextResponse.json(r, { status: 400 });
        await logActivity({ actor: user.name, actorRole: user.role, action: "quotation.submit", entity: "quotation", entityId: num(b.quotationId), summary: `Submitted quotation #${num(b.quotationId)} for admin approval` });
        return NextResponse.json({ ok: true });
      }
      case "decide": {
        if (!isAdmin) return NextResponse.json({ ok: false, error: "Only admin can approve/reject." }, { status: 403 });
        const approve = !!b.approve;
        const r = await decideQuotation(num(b.quotationId), approve, String(b.note || ""), user.name);
        if (!r.ok) return NextResponse.json(r, { status: 400 });
        await logActivity({ actor: user.name, actorRole: user.role, action: approve ? "quotation.approve" : "quotation.reject", entity: "quotation", entityId: num(b.quotationId), summary: approve ? `Approved quotation #${num(b.quotationId)} → indent ${r.indentNo}` : `Rejected quotation #${num(b.quotationId)}` });
        return NextResponse.json(r);
      }
      case "generatePO": {
        if (!canPurchase && !isAdmin) return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
        const r = await generatePOsFromIndent(num(b.indentId), user.id);
        if (!r.ok) return NextResponse.json(r, { status: 400 });
        await logActivity({ actor: user.name, actorRole: user.role, action: "indent.order", entity: "indent", entityId: num(b.indentId), summary: `Generated ${r.pos.length} PO(s) from indent #${num(b.indentId)}: ${r.pos.map((p) => p.poNo).join(", ")}` });
        return NextResponse.json(r);
      }
      default:
        return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
