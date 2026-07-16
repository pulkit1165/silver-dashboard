import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { aiAvailable, decodeTextOrder } from "@/lib/erp/sales-decode";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot create sales orders.` }, { status: 403 });
  }
  if (!aiAvailable()) {
    return NextResponse.json(
      { ok: false, error: "Text decode requires an ANTHROPIC_API_KEY on the server." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim();
  const customerHint = typeof body.customer_hint === "string" ? body.customer_hint.trim() : undefined;

  if (!text) return NextResponse.json({ ok: false, error: "No order text provided." }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ ok: false, error: "Text too long (max 4000 chars)." }, { status: 413 });

  try {
    const draft = await decodeTextOrder(text, customerHint);
    void logActivity({
      actor: user.name, actorRole: user.role,
      action: "sales.decode_text", entity: "sales_order",
      summary: `Decoded text order → ${draft.lines.length} line(s), party "${draft.customer_hint || "?"}"`,
    });
    return NextResponse.json({ ok: true, draft });
  } catch (e) {
    console.error("text decode failed:", e);
    return NextResponse.json({ ok: false, error: "Could not parse the order text. Please try again." }, { status: 502 });
  }
}
