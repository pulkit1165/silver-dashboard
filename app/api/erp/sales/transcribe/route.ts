import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { transcribeAudio, whisperAvailable } from "@/lib/erp/whisper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Voice → text. The recorder uploads audio here; we return the transcript, which
// the client drops into the order text box and decodes via the existing text path.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canWrite(user.role, "sales")) {
    return NextResponse.json({ ok: false, error: `Role ${user.role} cannot enter orders.` }, { status: 403 });
  }
  if (!whisperAvailable()) {
    return NextResponse.json({ ok: false, error: "Voice isn't switched on yet — an OPENAI_API_KEY is required for transcription." }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ ok: false, error: "No audio file provided." }, { status: 400 });
  }
  const language = typeof form?.get("language") === "string" ? String(form.get("language")) : undefined;

  const result = await transcribeAudio(audio, { language });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, text: result.text });
}
