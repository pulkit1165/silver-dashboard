import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { smartRecommendations, recommendationContext, type PoConfig } from "@/lib/erp/po-engine";
import { aiAvailable, aiRecommendations } from "@/lib/erp/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // allow time for the LLM call when a key is present

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
    onlyNeeding: true,
  };

  // Prefer Claude when configured; fall back to the heuristic engine.
  if (aiAvailable()) {
    const ctx = await recommendationContext(cfg);
    const ai = await aiRecommendations(ctx);
    if (ai && ai.length) {
      return NextResponse.json({ ok: true, source: "ai", recommendations: ai });
    }
  }

  const recommendations = await smartRecommendations(cfg);
  return NextResponse.json({ ok: true, source: "heuristic", recommendations });
}
