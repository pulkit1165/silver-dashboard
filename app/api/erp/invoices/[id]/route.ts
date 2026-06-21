import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { getInvoiceFull, updateDraftInvoice, cancelDraftInvoice, type InvoicePatch } from "@/lib/erp/invoices";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const full = await getInvoiceFull(id);
  if (!full) return NextResponse.json({ ok: false, error: "Invoice not found." }, { status: 404 });
  return NextResponse.json({ ok: true, ...full });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "invoices")) {
    return NextResponse.json({ ok: false, error: `Your role (${user.role}) cannot edit invoices.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as InvoicePatch;
  const result = await updateDraftInvoice(Number(id), body);
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "invoices")) {
    return NextResponse.json({ ok: false, error: `Your role (${user.role}) cannot delete invoices.` }, { status: 403 });
  }
  const { id } = await ctx.params;
  const result = await cancelDraftInvoice(Number(id));
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true });
}
