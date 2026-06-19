# Silver Industries Dashboard — project context (read this first)

Read-only **Next.js** reporting dashboard for Silver Industries (bike parts),
backed by an **Oracle 11g** database (`SILVER_2026`). This file is the handoff so
a new Claude Code session — including on a different computer — continues exactly
where we left off.

## Current status
- UI is complete and runs on **sample data**. Premium **white + red** theme
  (Manrope font), modeled on the TransfersX dashboard.
- The **Home** screen mirrors the client's legacy app: SALE, PURCHASE,
  RECEIVABLE, BANK BALANCE, TOTAL DR/CR, with a DATE/DAY header, Refresh button,
  Sale-Purchase / Stock tabs, and a KPI strip. Figures come from
  `lib/sample-data.ts`.
- **Not yet connected to live Oracle** — see below.

## Oracle connection — what we know (important)
- DB: **Oracle 11g**, schema `SILVER_2026`, server `73.149.135.125:8152`, TNS
  alias `DISH`. The original app connects with
  `Provider=MSDAORA.1;...;Data Source=DISH` (thick-mode OCI on Windows).
- Port 8152 is an Oracle **TCPS (TLS)** listener; self-signed cert
  `CN=DISHA-C2`, saved at `certs/DISHA-C2.pem`. One-way TLS (no client cert).
- **Every generic client is rejected right after the TLS handshake:**
  node-oracledb thin → TCP reset; Oracle JDBC / SQL Developer → `internal_error`.
  Reason: 11g + TCPS requires Oracle's **own OCI client**. Thin mode also needs
  Oracle 12.1+, so it can never work against 11g.
- **The way in:** Oracle **Instant Client 19c** (newest that still supports an
  11g server) in **thick mode** + a wallet that trusts the cert — OR run on the
  Windows machine that already connects. The one remaining unknown is the real
  **service name** inside the `tnsnames.ora` `DISH` descriptor.

## How to go live (all strictly read-only)
1. **On Windows (recommended):** install the Oracle 11g client / Instant Client;
   configure `tnsnames.ora` (the `DISH` entry) + `sqlnet.ora`
   (`WALLET_LOCATION`, `SSL_SERVER_DN_MATCH=no`); build a wallet from
   `certs/DISHA-C2.pem` (the server cert we captured). Test with
   `sqlplus SILVER_2026/<pwd>@DISH`. Then either set thick mode in `.env.local`
   (`ORACLE_CLIENT_LIB_DIR` + `ORACLE_CONFIG_DIR`) or run `connector/serve.mjs`
   there and point the UI at it with `REMOTE_DATA_URL`. See `SETUP-WINDOWS.md`.
2. Discover the schema (Data Explorer page, or `connector/discover.mjs`), then
   fill the live SQL into `lib/queries.ts` (analytics pages) and `OPS_QUERIES`
   (home screen). The dashboards switch to live data automatically.
3. **From the client's developer**, get: the `tnsnames.ora` `DISH` entry (the
   real service name), confirmation no client certificate is required, ideally a
   **read-only** DB user, and the SQL/views behind the home-screen figures.

## ERP modules (added on top of the read-only dashboard)
The Home screen (`/`) is unchanged. A full ERP lives under `/erp/*` on a
**production PostgreSQL** data layer (managed) — independent of the read-only
Oracle reporting link, which can sync in later.

- **Database:** PostgreSQL. Schema in `lib/erp/schema.ts` (Drizzle); migrations via
  `npm run db:push`; seed via `npm run db:seed` (idempotent). Runtime queries use
  **postgres.js** (`lib/erp/db.ts` → `getSql()`), returning snake_case rows.
  Connection via `DATABASE_URL` (dev = local Postgres `brew services start postgresql@16`;
  prod = **Neon** on Vercel — see `DEPLOY.md`).
- **Data/logic:** `lib/erp/db.ts` (postgres.js client), `lib/erp/schema.ts` (Drizzle),
  `lib/erp/queries.ts` (async reads), `lib/erp/scan.ts` (async scan engine, transactions),
  `lib/erp/qr.ts` (QR images), `lib/erp/rbac.ts` (roles + NAV + permissions),
  `lib/erp/session.ts` (cookie user/role), `scripts/db-seed.mjs` (seed).
- **QR is fully working** (priority): secure random token per SKU (`SQR-…`, not the
  SKU code), backend validation (unknown/inactive rejected), camera scanning via
  `getUserMedia`+`jsQR` (`components/erp/Scanner.tsx`, continuous mode, permission
  handling, manual-entry fallback), all actions (lookup/inward/outward/transfer/
  count/pick/pack/dispatch/damage/verify) updating inventory atomically, dispatch
  matching against sales orders (wrong-item + over-dispatch rejected), full audit
  trail (success AND failures with reason) in `scan_events`.
- **APIs:** `/api/erp/scan/validate`, `/api/erp/scan/action`, `/api/erp/scans`,
  `/api/erp/qr/[token]`, `/api/erp/qr/bulk`, `/api/erp/skus`, `/api/erp/sales-orders/[id]`,
  `/api/erp/auth` (role switch).
- **Screens:** `/erp` (dashboard), `/erp/scan`, `/erp/scan/dispatch`, `/erp/scan/history`,
  `/erp/qr` (bulk labels: A4 + thermal, print CSS), `/erp/skus` (+`/[id]` QR detail),
  `/erp/inventory`, `/erp/sales` (+`/[id]`), `/erp/customers`, `/erp/vendors`,
  `/erp/purchase`, `/erp/warehouses`, `/erp/finance`, `/erp/reports`, `/erp/users`.
- **Roles** (sidebar switcher, demo): admin/sales/purchase/inventory/warehouse/
  dispatch/accounts/viewer. Nav + write actions gated by `rbac.ts`.
- **Note:** phone camera needs HTTPS (secure context). On `http://<lan-ip>` use the
  manual token box, or serve over HTTPS / a tunnel for real phone scanning.
- **Deeper vs foundational:** QR + inventory + sales/dispatch are deep; vendors/
  customers/purchase/finance/reports/users are DB-backed list/summary screens ready
  to extend. Real auth/2FA, Excel/PDF export, and Oracle sync are the next layers.

## Run / build
- `npm install`, then `npm run dev` → http://localhost:3000
- Connection settings live in `.env.local` (gitignored — recreate from
  `.env.example`; it is NOT in this repo).

## Safety — do not break this
Strictly read-only: only single `SELECT`/`WITH` statements, executed inside
`SET TRANSACTION READ ONLY` (Oracle rejects writes with ORA-01456), `autoCommit`
never enabled, statement timeout + row cap. Never add a write path.

## Architecture map
- `lib/oracle.ts` — read-only Oracle access (thin / thick / remote) + write guards.
- `lib/data.ts` — chooses live Oracle vs sample data.
- `lib/queries.ts` — **map real SQL here** (`QUERIES` + `OPS_QUERIES`).
- `lib/sample-data.ts` — built-in demo figures (matches the client screenshot).
- `components/OpsDashboard.tsx` — the Home report screen.
- `app/` — Home, Inventory, Sales, Data Explorer, Connection + read-only API routes.
- `connector/` — standalone read-only data service for the trusted host.
- `docs/handoff/` — copies of the project memory notes (full diagnosis & history).

@AGENTS.md
