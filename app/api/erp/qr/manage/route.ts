import { NextResponse } from "next/server";
import { getSql, genToken } from "@/lib/erp/db";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "skus")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot manage QR codes.` }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const sql = getSql();

  try {
    switch (b.action) {
      case "disable": {
        await sql`UPDATE qr_codes SET status='disabled' WHERE token=${String(b.token)} AND status='active'`;
        await logActivity({ actor: user.name, actorRole: user.role, action: "qr.disable", entity: "qr", summary: `Disabled QR ${String(b.token)}` });
        return NextResponse.json({ ok: true, message: "QR code disabled" });
      }
      case "regenerate": {
        const skuId = Number(b.skuId);
        const [sku] = await sql`SELECT id, sku_code FROM skus WHERE id=${skuId}`;
        if (!sku) return NextResponse.json({ ok: false, error: "SKU not found" }, { status: 404 });
        await sql`UPDATE qr_codes SET status='replaced' WHERE sku_id=${skuId} AND status='active'`;
        const token = genToken();
        await sql`INSERT INTO qr_codes (sku_id,sku_code,token,status,created_by) VALUES (${skuId},${(sku as { sku_code: string }).sku_code},${token},'active',${user.name})`;
        await sql`UPDATE skus SET qr_token=${token} WHERE id=${skuId}`;
        await logActivity({ actor: user.name, actorRole: user.role, action: "qr.regenerate", entity: "sku", entityId: skuId, summary: `Regenerated QR for ${(sku as { sku_code: string }).sku_code}` });
        return NextResponse.json({ ok: true, message: "QR code regenerated", token });
      }
      case "generate-missing": {
        const missing = (await sql`
          SELECT s.id, s.sku_code FROM skus s
          LEFT JOIN qr_codes q ON q.sku_id=s.id AND q.status='active'
          WHERE q.id IS NULL`) as unknown as { id: number; sku_code: string }[];
        for (const m of missing) {
          const token = genToken();
          await sql`INSERT INTO qr_codes (sku_id,sku_code,token,status,created_by) VALUES (${m.id},${m.sku_code},${token},'active',${user.name})`;
          await sql`UPDATE skus SET qr_token=${token} WHERE id=${m.id}`;
        }
        if (missing.length) await logActivity({ actor: user.name, actorRole: user.role, action: "qr.generate", entity: "qr", summary: `Generated ${missing.length} missing QR code(s)`, meta: { count: missing.length } });
        return NextResponse.json({ ok: true, message: `Generated ${missing.length} QR code(s)`, count: missing.length });
      }
      case "mark-printed": {
        const tokens: string[] = Array.isArray(b.tokens) ? b.tokens.map(String) : [];
        if (tokens.length) await sql`UPDATE qr_codes SET printed=true WHERE token = ANY(${tokens})`;
        return NextResponse.json({ ok: true, marked: tokens.length });
      }
      default:
        return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
