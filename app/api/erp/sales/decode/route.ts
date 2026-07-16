import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { logActivity } from "@/lib/erp/activity";
import { aiAvailable, decodeSalesImage } from "@/lib/erp/sales-decode";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // vision + matching can take a while on a busy slip

const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const MAX_BASE64 = 12 * 1024 * 1024; // ~9 MB decoded

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot create sales orders.` }, { status: 403 });
  }
  if (!aiAvailable()) {
    return NextResponse.json(
      { ok: false, error: "The Sales Decoder isn't configured yet — an ANTHROPIC_API_KEY is required." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  let image = String(body.image_base64 ?? "");
  let mediaType = String(body.media_type ?? "");

  // Accept a full data URL too (data:image/png;base64,....).
  const m = image.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (m) {
    mediaType = mediaType || m[1];
    image = m[2];
  }
  image = image.trim();
  mediaType = (mediaType || "image/jpeg").toLowerCase();

  if (!image) return NextResponse.json({ ok: false, error: "No image provided." }, { status: 400 });
  if (!ALLOWED.has(mediaType)) {
    return NextResponse.json({ ok: false, error: `Unsupported image type: ${mediaType}. Use JPG, PNG, WebP or GIF.` }, { status: 415 });
  }
  if (image.length > MAX_BASE64) {
    return NextResponse.json({ ok: false, error: "Image is too large (max ~9 MB). Retake at lower resolution." }, { status: 413 });
  }
  if (mediaType === "image/jpg") mediaType = "image/jpeg";

  try {
    const draft = await decodeSalesImage(image, mediaType);
    void logActivity({
      actor: user.name, actorRole: user.role,
      action: "sales.decode", entity: "sales_order",
      summary: `Decoded a handwritten order slip → ${draft.lines.length} line(s), party "${draft.customer_hint || "?"}"`,
    });
    return NextResponse.json({ ok: true, draft });
  } catch (e) {
    console.error("sales decode failed:", e);
    return NextResponse.json(
      { ok: false, error: "Could not read the slip. Try a clearer, well-lit photo." },
      { status: 502 },
    );
  }
}
