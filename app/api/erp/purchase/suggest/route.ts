import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { generatePoSuggestions, type PoConfig } from "@/lib/erp/po-engine";

export const dynamic = "force-dynamic";

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  if (!isDate(b.from) || !isDate(b.to)) {
    return NextResponse.json({ ok: false, error: "Valid from/to dates required." }, { status: 400 });
  }
  const cfg: PoConfig = {
    from: b.from,
    to: b.to,
    margin: Math.max(0, Math.min(100, Number(b.margin) || 0)),
    onlyNeeding: b.onlyNeeding !== false,
  };

  const { suggestions, totals } = await generatePoSuggestions(cfg);
  return NextResponse.json({ ok: true, suggestions, totals });
}
