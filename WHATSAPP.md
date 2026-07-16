# WhatsApp Assistant — Phase 1 (Conversational Q&A)

A WhatsApp bot on the **Meta WhatsApp Cloud API** that answers questions about the
business over the live ERP (reuses the read-only "Ask AI" Claude NL→SQL brain).
Staff message the bot → it replies with real numbers. Because the user always
messages first, replies land inside WhatsApp's 24-hour window, so **no message
templates are needed for Phase 1**. (Templates only matter later, for *proactive*
dept-to-dept notifications — Phase 2/3.)

## What was built
- `lib/erp/assistant.ts` → `runAssistant(question, { role, channel })` — non-streaming
  runner (returns plain text; WhatsApp mode = short, no-markdown, Hindi/English/Hinglish).
- `lib/erp/whatsapp.ts` — Cloud API client: `sendText`, webhook `verifySignature`
  (X-Hub-Signature-256), `parseInbound`, `resolveContact`, message log + idempotency.
- `app/api/whatsapp/webhook/route.ts` — `GET` verify handshake + `POST` receive →
  resolve contact → `runAssistant` → reply → log. Idempotent by Meta message id.
- Schema: `whatsapp_contacts` (phone→user/role, opt-in) and `whatsapp_messages` (audit).
- `proxy.ts` bypass for `/api/whatsapp/webhook` (auth = signature, not session).

## One-time Meta setup (you must do this — needs your Meta Business account)
1. **Meta Business + App.** developers.facebook.com → create/choose an App →
   add the **WhatsApp** product. Complete **Business verification** (needed to
   message beyond test numbers).
2. **WABA + sending number.** In WhatsApp → API Setup, note the **Phone number ID**
   (a numeric id, *not* the phone) and register/verify the business number.
3. **Permanent token.** Create a **System User** (Business Settings → Users →
   System Users) with the `whatsapp_business_messaging` + `whatsapp_business_management`
   permissions on the WABA, and generate a **permanent access token** (the token
   shown on the API Setup page is only 24h — don't use it in prod).
4. **App Secret.** App → Settings → Basic → **App Secret**.
5. **Set env** (in `.env.local` for dev and Vercel project env for prod):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   WHATSAPP_TOKEN=<permanent system-user token>
   WHATSAPP_PHONE_NUMBER_ID=<numeric phone number id>
   WHATSAPP_VERIFY_TOKEN=<any random string you invent>
   WHATSAPP_APP_SECRET=<app secret>
   ```
6. **Register the webhook.** WhatsApp → Configuration → Webhook:
   - Callback URL: `https://silver-dashboard-eight.vercel.app/api/whatsapp/webhook`
   - Verify token: the **same** string as `WHATSAPP_VERIFY_TOKEN`.
   - Click **Verify and Save** (this triggers the `GET` handshake), then
     **Subscribe** to the **`messages`** field.
7. **Register staff numbers** (only known numbers may use the bot). E.164 digits,
   no `+` (e.g. India = `9198XXXXXXXX`):
   ```sql
   INSERT INTO whatsapp_contacts (phone, name, role, opt_in, active)
   VALUES ('9198XXXXXXXX', 'Sandeep (Sales)', 'sales', true, true);
   ```
   `role` mirrors the ERP roles (admin/sales/accounts/warehouse/dispatch/…) and
   scopes how the answer is framed.

## Migration
`npm run db:push` adds `whatsapp_contacts` + `whatsapp_messages` (run on local,
then Neon prod).

## Test it
1. From a **registered** number, WhatsApp your business number: "hi" → get the
   welcome; then "today's sale" / "pending dispatches" / "DEEPAK outstanding".
2. During dev you can expose localhost with a tunnel (e.g. `cloudflared`/`ngrok`)
   and point the Meta webhook there; or test against the deployed Vercel URL.
3. Every message (in + out) is logged in `whatsapp_messages`.

## Important constraints (by design, WhatsApp Cloud API)
- **1:1 only** — the Cloud API cannot post into WhatsApp *group* chats. "Notify the
  team" (Phase 2) = fan-out to individuals via approved **templates**.
- **24-hour window** — outside 24h of the user's last message you may only send
  pre-approved templates. Phase 1 (reply-only) stays inside the window, so it's fine.
- **Opt-in** — only registered, `opt_in=true` contacts are served.
- Never use unofficial WhatsApp libraries (ban risk) — Cloud API only.

## Next phases
- **Phase 2** — proactive dept-to-dept notifications from `activity_log` + a rule
  table + a scheduler (daily summary, payment-due, reorder). Needs approved templates.
- **Phase 3** — interactive Approve/Reject buttons that write back to the ERP.
