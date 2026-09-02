import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { getCompanySettings, saveCompanySettings, type CompanySettings } from "@/lib/erp/invoices";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const settings = await getCompanySettings();
  return NextResponse.json({ ok: true, settings });
}

const EDITABLE_KEYS: (keyof CompanySettings)[] = [
  "legal_name", "trade_name", "gstin", "state_code", "address", "city", "pincode",
  "phone", "email", "msme_no", "bank_name", "bank_account", "bank_ifsc", "bank_branch",
  "invoice_prefix", "invoice_next_no", "terms", "ewb_threshold",
];

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "company_settings")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit company settings.` }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const patch: Partial<CompanySettings> = {};
  for (const k of EDITABLE_KEYS) {
    if (body[k] === undefined) continue;
    (patch as Record<string, unknown>)[k] = k === "invoice_next_no" || k === "ewb_threshold" ? Number(body[k]) : String(body[k]);
  }
  if (patch.gstin && !/^[0-9A-Z]{15}$/.test(patch.gstin)) {
    return NextResponse.json({ ok: false, error: "GSTIN must be 15 characters (letters/digits)." }, { status: 400 });
  }
  await saveCompanySettings(patch);
  await logActivity({
    actor: user.name, actorRole: user.role,
    action: "company_settings.save", entity: "company_settings", entityId: 1,
    summary: "Updated company GST/invoice settings", meta: patch,
  });
  const settings = await getCompanySettings();
  return NextResponse.json({ ok: true, settings });
}
