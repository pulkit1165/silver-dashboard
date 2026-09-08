import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { setCatalogNote, setCatalogLogo, setCatalogPhoto } from "@/lib/erp/catalogExtras";

export const dynamic = "force-dynamic";

const CAN = new Set(["admin", "inventory", "sales", "accounts", "purchase"]);
const MAX_IMG = 600_000; // ~600KB data-URL cap (client compresses well below this)

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!CAN.has(user.role)) return NextResponse.json({ ok: false, error: `Role ${user.role} cannot edit the catalogue.` }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const kind = String(b.kind || "");
  try {
    if (kind === "note") {
      await setCatalogNote(String(b.text ?? ""), user.name);
    } else if (kind === "logo") {
      const url = String(b.dataUrl ?? "");
      if (url && (url.length > MAX_IMG || !/^data:image\//.test(url)))
        return NextResponse.json({ ok: false, error: "Image too large or not an image." }, { status: 400 });
      await setCatalogLogo(url, user.name);
    } else if (kind === "photo") {
      const header = String(b.header ?? "").trim();
      const url = String(b.dataUrl ?? "");
      if (!header) return NextResponse.json({ ok: false, error: "Missing category." }, { status: 400 });
      if (url && (url.length > MAX_IMG || !/^data:image\//.test(url)))
        return NextResponse.json({ ok: false, error: "Image too large or not an image." }, { status: 400 });
      await setCatalogPhoto(header, url, user.name);
    } else {
      return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
