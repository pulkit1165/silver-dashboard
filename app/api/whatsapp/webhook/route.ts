import { NextResponse } from "next/server";
import { aiAvailable } from "@/lib/erp/ai";
import { logActivity } from "@/lib/erp/activity";
import { runAssistant } from "@/lib/erp/assistant";
import {
  WHATSAPP_VERIFY_TOKEN, verifySignature, parseInbound, sendText,
  resolveContact, alreadyProcessed, logMessage,
} from "@/lib/erp/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Claude may run several query rounds

// ── GET: Meta webhook verification handshake ─────────────────────────────────
// Meta calls this once when you register the webhook. Echo hub.challenge back as
// plain text iff the verify token matches.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === WHATSAPP_VERIFY_TOKEN()) {
    return new Response(challenge ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

// ── POST: inbound messages ───────────────────────────────────────────────────
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("Bad signature", { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }

  const messages = parseInbound(payload);
  // Process sequentially; each is idempotent by message id. We answer inline then
  // return 200. (Future: enqueue + return 200 immediately for faster ack.)
  for (const m of messages) {
    try {
      await handleOne(m);
    } catch (e) {
      await logMessage({ direction: "in", waMessageId: m.waMessageId, phone: m.from, body: m.text, status: "failed", error: String((e as Error)?.message || e) });
    }
  }
  // Always 200 so Meta doesn't disable the webhook.
  return NextResponse.json({ ok: true });
}

async function handleOne(m: { waMessageId: string; from: string; name: string | null; text: string; type: string }) {
  if (m.type !== "text" && m.type !== "interactive" && m.type !== "button") return;
  if (await alreadyProcessed(m.waMessageId)) return; // webhook retry — skip

  const contact = await resolveContact(m.from);
  await logMessage({ direction: "in", waMessageId: m.waMessageId, phone: m.from, contactId: contact?.id ?? null, body: m.text, status: contact ? "received" : "ignored" });

  // Unknown numbers get a single polite bounce (no data access).
  if (!contact) {
    await sendText(m.from, "This number isn't registered for the Silver Industries assistant. Please contact your admin to get access.");
    return;
  }
  if (!aiAvailable()) {
    await sendText(m.from, "The assistant isn't switched on yet (missing API key). Please try again later.");
    return;
  }

  const text = (m.text || "").trim();
  if (!text) return;
  if (/^(hi|hello|hey|start|menu|help)$/i.test(text)) {
    await sendText(m.from, `Hi ${contact.name ?? ""}! I'm the Silver Industries assistant. Ask me about sales, orders, stock, customers or invoices — e.g. "today's sale", "pending dispatches", "DEEPAK's outstanding".`);
    return;
  }

  const result = await runAssistant(text, { role: contact.role, channel: "whatsapp" });
  const answer = result.ok && result.answer ? result.answer : "Sorry — I couldn't answer that just now. Please rephrase or try again.";
  const sent = await sendText(m.from, answer);

  await logMessage({ direction: "out", phone: m.from, contactId: contact.id, body: answer, status: sent.ok ? "sent" : "failed", error: sent.error ?? null });
  void logActivity({
    actor: contact.name ?? m.from, actorRole: contact.role, action: "whatsapp.query",
    entity: "whatsapp", summary: `WhatsApp Q: "${text.slice(0, 120)}"`,
  });
}
