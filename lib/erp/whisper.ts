import "server-only";

// Speech-to-text for the voice order path. Claude has no audio input, so we
// transcribe first with OpenAI Whisper, then feed the text into decodeTextOrder.
// Needs OPENAI_API_KEY. Hindi/Hinglish transcribe well; we hint language auto.

export function whisperAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

const WHISPER_MODEL = process.env.WHISPER_MODEL || "whisper-1";

export async function transcribeAudio(
  file: File,
  opts: { language?: string; prompt?: string } = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!whisperAvailable()) return { ok: false, error: "Voice transcription isn't configured (OPENAI_API_KEY missing)." };
  if (!file || file.size === 0) return { ok: false, error: "No audio received." };
  if (file.size > 24 * 1024 * 1024) return { ok: false, error: "Recording too large (max ~24MB). Keep it under a couple of minutes." };

  const form = new FormData();
  form.append("file", file, file.name || "order.webm");
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "json");
  if (opts.language) form.append("language", opts.language);
  // A domain prompt nudges Whisper toward the right jargon/brand spellings.
  form.append("prompt", opts.prompt ?? "Wholesale two-wheeler spare parts order: Hero Honda, Bajaj, TVS, Aktiva, Splendor, Pulsar, quantities and item names.");

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: data?.error?.message ?? `Transcription failed (HTTP ${res.status}).` };
    return { ok: true, text: String(data.text ?? "").trim() };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 300) };
  }
}
