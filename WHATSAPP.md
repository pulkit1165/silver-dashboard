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

## Phase 2, shipped: low-stock alert to the purchase dept

Daily cron (`vercel.json` → `/api/cron/stock-alerts`, 3:30 UTC = 9:00 AM IST) runs
`runStockAlertScan()` (`lib/erp/stock-alerts.ts`). Logic:
- Flags any active SKU where `qty <= reorder_level` (self-creates `stock_alert_state`
  to track what's already been notified — no `db:push` needed, same pattern as
  `activity_log`/`print_jobs`).
- Sends **at most one** WhatsApp template per purchase contact per run, and only
  when a SKU is newly breached, has escalated (reorder → low → out), or hasn't
  been re-notified in 24h — never one message per SKU. This is also the main cost
  lever: Meta bills per 24-hour conversation, not per message, so batching
  everything into one send per contact per day keeps this to (at most) a handful
  of billed conversations a day, not one per SKU.
- The template carries only a count; recipients reply (e.g. "which items?") to
  get the full list from the existing Ask-AI bot for free, inside the 24h window
  the template just opened — no second template needed for the detail.
- Every send is logged to `whatsapp_messages` and one summary row to `activity_log`
  (`action: "whatsapp.stock_alert"`).

### One-time setup for this feature
1. **Register purchase-dept numbers** with `role='purchase'` (same table/pattern
   as above):
   ```sql
   INSERT INTO whatsapp_contacts (phone, name, role, opt_in, active)
   VALUES ('9198XXXXXXXX', 'Purchase — Ramesh', 'purchase', true, true);
   ```
   Keep this list small (2–4 numbers) — each additional recipient is its own
   billable conversation every time an alert fires.
2. **Create the Meta message template** — WhatsApp Manager → Message Templates →
   Create:
   - **Category: Utility.** This is the single biggest cost lever. A stock-level
     alert to your own staff is a legitimate operational/utility notification —
     do *not* let it get filed as Marketing, which Meta prices noticeably higher.
   - **Name:** `low_stock_alert` (must match `WHATSAPP_STOCK_ALERT_TEMPLATE`,
     defaults to this if unset).
   - **Language:** English (`en`) — set `WHATSAPP_STOCK_ALERT_LANG` if you pick
     a different one.
   - **Body** (keep it short and low-variable — templates with a long/dynamic-
     looking variable, e.g. a stuffed SKU list, are the ones Meta tends to reject
     or query on review):
     ```
     ⚠️ Stock Alert: {{1}} item(s) are at or below reorder level as of {{2}}.
     Reply and ask "which items" for the full list.
     ```
     (`{{1}}` = count, `{{2}}` = date — exactly what `runStockAlertScan()` sends.)
   - Submit for review (usually minutes, occasionally up to ~24h).
3. **Set `skus.reorder_level`** for the SKUs you want covered — the alert is
   silent for any SKU where it's still 0 (the import default), by design (avoids
   an alert flood on a catalogue where most items were never given a threshold).

### Keeping WhatsApp cost as low as possible, generally
- **Utility, not Marketing, category** for anything operational — biggest lever,
  see above.
- **One conversation window per recipient per period**, not per event — Meta
  bills per 24h window for template-opened conversations, so batch triggers
  instead of firing a template per SKU/event (this is why the digest above is
  built the way it is; apply the same rule to any future Phase 2 notification).
- **Small, fixed recipient lists** — a role-scoped `whatsapp_contacts` row set
  (e.g. `role='purchase'`), not a broadcast to all staff.
- **Push detail into free-form replies**, not more templates — a reply inside
  the 24h window a template just opened is free and can go through the existing
  Ask-AI bot; only pay for the template that starts the conversation.
- **Direct Meta Cloud API** (already the architecture here) — a BSP layer
  (Twilio/Gupshup/etc.) adds its own per-message markup on top of Meta's rate;
  staying direct avoids that entirely.
- **Test against a Meta test number** during template development so iterating
  on wording doesn't burn paid conversations on the production number.
- Meta's exact per-category/per-country rates change over time — check the live
  card in WhatsApp Manager → Account Tools → Pricing before relying on a number
  from anywhere else, including this doc.
