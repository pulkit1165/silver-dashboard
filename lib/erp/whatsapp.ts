import "server-only";
import crypto from "node:crypto";
import { getSql } from "./db";

// ── Config ───────────────────────────────────────────────────────────────────
// Meta WhatsApp Cloud API. All four are set in .env.local / Vercel:
//   WHATSAPP_TOKEN            permanent (system-user) access token
//   WHATSAPP_PHONE_NUMBER_ID  the sending number's id (NOT the phone itself)
//   WHATSAPP_VERIFY_TOKEN     arbitrary string you also paste into the Meta webhook UI
//   WHATSAPP_APP_SECRET       the app secret (verifies inbound webhook signatures)
const GRAPH_VERSION = "v21.0";
const MAX_WA_TEXT = 4096; // WhatsApp hard limit per text message

export function whatsappConfigured(): boolean {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export const WHATSAPP_VERIFY_TOKEN = () => process.env.WHATSAPP_VERIFY_TOKEN ?? "";

// ── Inbound: signature verification ──────────────────────────────────────────
// Meta signs the raw body with the app secret (X-Hub-Signature-256: sha256=<hex>).
// If no app secret is configured we skip (dev only) — set it in production.
export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // dev fallback — configure WHATSAPP_APP_SECRET in prod
  if (!signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Inbound: payload parsing ─────────────────────────────────────────────────
export interface InboundMessage {
  waMessageId: string;
  from: string; // sender phone, E.164 digits (no '+')
  name: string | null;
  text: string;
  type: string;
}

/** Pull the user text messages out of a Cloud API webhook payload (ignores statuses). */
export function parseInbound(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as Array<{ changes?: unknown[] }>) {
    for (const change of (entry.changes ?? []) as Array<{ value?: Record<string, unknown> }>) {
      const value = change.value ?? {};
      const contacts = (value.contacts ?? []) as Array<{ profile?: { name?: string }; wa_id?: string }>;
      const nameByWaId = new Map(contacts.map((c) => [c.wa_id ?? "", c.profile?.name ?? null]));
      const messages = (value.messages ?? []) as Array<Record<string, unknown>>;
      for (const m of messages) {
        const type = String(m.type ?? "");
        const from = String(m.from ?? "");
        const waMessageId = String(m.id ?? "");
        let text = "";
        if (type === "text") text = String((m.text as { body?: string })?.body ?? "");
        else if (type === "button") text = String((m.button as { text?: string })?.text ?? "");
        else if (type === "interactive") {
          const it = m.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } };
          text = it?.button_reply?.title ?? it?.list_reply?.title ?? "";
        }
        out.push({ waMessageId, from, name: nameByWaId.get(from) ?? null, text, type });
      }
    }
  }
  return out;
}

// ── Outbound: send a text message ────────────────────────────────────────────
export async function sendText(to: string, body: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!whatsappConfigured()) return { ok: false, error: "WhatsApp not configured" };
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const text = body.length > MAX_WA_TEXT ? body.slice(0, MAX_WA_TEXT - 1) + "…" : body;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } }),
    });
    const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string } };
    if (!res.ok) return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, id: data?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 300) };
  }
}

// ── Contacts ─────────────────────────────────────────────────────────────────
export interface WaContact { id: number; phone: string; user_id: number | null; name: string | null; role: string; opt_in: boolean; active: boolean }

/** Look up a staff contact by phone. Only known, active, opted-in numbers may use the bot. */
export async function resolveContact(phone: string): Promise<WaContact | null> {
  const [row] = await getSql()`SELECT * FROM whatsapp_contacts WHERE phone=${phone} AND active=true AND opt_in=true`;
  return (row as WaContact | undefined) ?? null;
}

// ── Message log + idempotency ────────────────────────────────────────────────
/** True if this inbound message id was already processed (webhook retry). */
export async function alreadyProcessed(waMessageId: string): Promise<boolean> {
  if (!waMessageId) return false;
  const [row] = await getSql()`SELECT 1 FROM whatsapp_messages WHERE wa_message_id=${waMessageId} AND direction='in' LIMIT 1`;
  return !!row;
}

export async function logMessage(m: {
  direction: "in" | "out";
  waMessageId?: string | null;
  phone?: string | null;
  contactId?: number | null;
  body?: string | null;
  status?: string | null;
  error?: string | null;
}): Promise<void> {
  await getSql()`
    INSERT INTO whatsapp_messages (direction, wa_message_id, phone, contact_id, body, status, error)
    VALUES (${m.direction}, ${m.waMessageId ?? null}, ${m.phone ?? null}, ${m.contactId ?? null},
            ${(m.body ?? "").slice(0, 4000)}, ${m.status ?? null}, ${m.error ?? null})`;
}
