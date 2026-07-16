# Silver Industries Dashboard — project context (read this first)

Read-only **Next.js** reporting dashboard for Silver Industries (bike parts),
backed by an **Oracle 11g** database (`SILVER_2026`). This file is the handoff so
a new Claude Code session — including on a different computer — continues exactly
where we left off.

## Current status — HOME SCREEN IS LIVE (as of 2026-07-17)
- UI is complete. Premium **white + red** theme (Manrope font), modeled on
  the TransfersX dashboard.
- The **Home** screen mirrors the client's legacy app: SALE, PURCHASE,
  RECEIVABLE, BANK BALANCE, TOTAL DR/CR, with a DATE/DAY header, Refresh button,
  Sale-Purchase / Stock tabs, and a KPI strip.
- **All 6 home-screen KPIs wired to live Oracle** — `getOpsSummary()` now runs
  real SQL via the connector. Confirmed figures (2026-07-17):
  - SALE today ₹0 / MTD ₹57.9L / YTD ₹6.7 crore (DTC102, TRTYPE=SO26)
  - PURCHASE today/MTD/YTD (DTC201, TRTYPE=MRN26)
  - BANK BALANCE ₹1.19 crore (VW_BANK_D, includes March-31 opening balance row)
  - RECEIVABLE ₹5.02 crore with aging buckets (VW_DR_PENDBILLS)
  - DR/CR outstanding (VW_DR_PENDBILLS / VW_CR_PENDBILLS)
  - Order in Hand = 130 pending SOs (VW_PEND_SO)

## Oracle connection — LIVE via sqlplus connector (read this carefully)
- DB: **Oracle 11g** (11.2.0.1.0 Enterprise Edition 64-bit), schema `SILVER_2026`,
  service name `DISH`. Actual DB machine: **192.168.100.60:1521** on the LAN.
- **The working architecture:** The connector runs on **192.168.100.17** (the
  Windows Server 2012 R2 RDP box at `73.149.135.125`, account `pulkit`, non-admin).
  It uses **sqlplus.exe as a child process** (spawned via Node's `child_process`)
  rather than node-oracledb, because:
  - node-oracledb thin mode requires Oracle 12.1+ (our DB is 11g) → NJS-138
  - node-oracledb thick mode needs the OCI client; the only available client on
    that server (`D:\oracle\product\10.2.0\client_1\bin\oci.dll`) is 32-bit
    (Oracle 10g client), while Node.js 16 is 64-bit → DPI-1047 mismatch
  - sqlplus.exe from the same 32-bit Oracle 10g client connects fine over plain
    TCP to the 11g DB at 192.168.100.60:1521 — architecture irrelevant for sqlplus
  - The connector uses `SET MARKUP HTML ON` for reliable table output parsing
- Login: SILVER_2026 / SILVER_2026.

### Exact paths on the server (Windows Server 2012 R2, `73.149.135.125`)
- Oracle 10g client (used for sqlplus): `D:\oracle\product\10.2.0\client_1\`
  - sqlplus.exe: `D:\oracle\product\10.2.0\client_1\BIN\sqlplus.exe`
  - tnsnames.ora: `D:\oracle\product\10.2.0\client_1\NETWORK\ADMIN\tnsnames.ora`
    (resolves DISH → 192.168.100.60:1521)
- Our connector: `C:\Users\pulkit\connector2\`
  - `oracle.mjs` — the sqlplus-based connector (copy of `connector/oracle-sqlplus.mjs`)
  - `serve.mjs` — HTTP server on port 8151
  - `package.json`, `node_modules/` (oracledb installed but unused)
- Node.js **16.20.2** (portable, no admin install):
  `C:\Users\pulkit\node16\node-v16.20.2-win-x64\node.exe`
- `lsnrctl status` lives at `D:\app\product\11.2.0\dbhome_1\bin\lsnrctl`.
  **If the ERP on the 10 client PCs ever shows "TNS not listening,"** RDP in
  and run `D:\app\product\11.2.0\dbhome_1\bin\lsnrctl start`. Always check
  `lsnrctl status` (look for service "DISH" status READY) before touching anything.

### How to start the connector manually (on the server via RDP)
```powershell
# Window 1 — start the connector (port 8151)
$nd = "C:\Users\pulkit\node16\node-v16.20.2-win-x64"
$env:PATH = "$nd;" + $env:PATH
$env:ORACLE_SQLPLUS_PATH = "D:\oracle\product\10.2.0\client_1\BIN\sqlplus.exe"
$env:ORACLE_CONFIG_DIR  = "D:\oracle\product\10.2.0\client_1\NETWORK\ADMIN"
$env:ORACLE_USER        = "SILVER_2026"
$env:ORACLE_PASSWORD    = "SILVER_2026"
$env:ORACLE_CONNECT_STRING = "DISH"
node C:\Users\pulkit\connector2\serve.mjs

# Window 2 — start localtunnel (keep this window open!)
$nd = "C:\Users\pulkit\node16\node-v16.20.2-win-x64"
$env:PATH = "$nd;" + $env:PATH
node "$nd\node_modules\localtunnel\bin\lt.js" --port 8151
# Copy the URL it prints, update REMOTE_DATA_URL in .env.local and Vercel
```

### Persistence (fragile — read before assuming it "just works")
- **No auto-start configured yet** (registry Run key attempted but connector2
  was rebuilt; needs to be re-wired). This means:
  - ✅ Survives RDP **disconnect** (session stays alive if you just close the window)
  - ❌ Does **not** survive a full **log off** or **server reboot**
  - ❌ **The tunnel URL changes every restart** (free localtunnel random subdomain).
    When that happens, `REMOTE_DATA_URL` in both `.env.local` (dev) and Vercel's
    env vars goes stale → site silently falls back to sample data.
- To re-wire auto-start (registry Run key, no admin needed):
  ```powershell
  $cmd = 'powershell -WindowStyle Hidden -Command "& C:\Users\pulkit\connector2\start-all.ps1"'
  Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SilverConnector" -Value $cmd
  ```
- For a stable URL: need admin rights (Cloudflare Tunnel with fixed domain) or
  router port forward so localtunnel can be dropped.

## Key Oracle tables (SILVER_2026 schema — all year-specific, all FY26 data)
| Table/View | Content | Key columns |
|---|---|---|
| DTC102 | Sales Orders (SO26) | TRDATE, AMOUNT, YEARENDBALANCE |
| DTC201 | Purchase/MRN (MRN26) | TRDATE, BILLAMOUNT |
| DTC106 | Delivery Orders (DO26) | TRDATE |
| DTC110 | Bank Book transactions | TRDATE, DR_AMOUNT, CR_AMOUNT, CANCEL |
| DTC400 | Cash/Bank Receipts (GC26) | TRDATE, BILLAMOUNT |
| DTD101 | Cash Book journal | TRDATE, DR_AMOUNT, CR_AMOUNT, A_CODE, B_CODE |
| VW_DR_PENDBILLS | Outstanding debtor invoices | PARTYID, INVDATE, BILLAMOUNT, BALAMOUNT |
| VW_CR_PENDBILLS | Outstanding creditor invoices | PARTYID, BALAMOUNT |
| VW_BANK_D | Bank book by account (incl. Mar-31 opening) | SERIES, TRDATE, DR_AMOUNT, CR_AMOUNT |
| VW_PEND_SO | Pending (undelivered) Sales Orders | COUNT(*) = 130 |
| VW_OPTRIALPOST | Opening trial balance (31-Mar-26) | PARTYID, DR_AMOUNT, CR_AMOUNT |
| VW_BANKBOOKPOST | Bank book double-entry ledger | PARTYID, DR_AMOUNT, CR_AMOUNT |

**Oracle 11g syntax only:** no `FETCH FIRST n ROWS ONLY` (use `rownum <=`),
no `LISTAGG` with overflow, no 12c+ features.

## Remaining work
1. **Auto-start on server**: Wire registry Run key so connector + localtunnel
   restart automatically when `pulkit` logs in (see commands above).
2. **Stable tunnel URL**: Either get admin rights for Cloudflare Tunnel (fixed
   hostname), or have the router admin forward a port so localtunnel can be dropped.
3. **Update Vercel env var**: After each localtunnel restart, update
   `REMOTE_DATA_URL` on Vercel dashboard (Settings → Environment Variables) to
   match the new tunnel URL printed in the localtunnel window.
4. **Domain dashboards**: `QUERIES` (salesTrend, byCategory, topParts etc.) in
   `lib/queries.ts` are still empty. Fill them for the `/erp` domain dashboard.

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
- `lib/data.ts` — chooses live Oracle vs sample data; `getOpsSummary()` runs live OPS_QUERIES.
- `lib/queries.ts` — `OPS_QUERIES` (home screen, fully mapped) + `QUERIES` (domain dashboards, still empty).
- `lib/sample-data.ts` — built-in demo figures (used as fallback).
- `components/OpsDashboard.tsx` — the Home report screen.
- `connector/oracle-sqlplus.mjs` — sqlplus-based connector (authoritative source for server).
- `app/` — Home, Inventory, Sales, Data Explorer, Connection + read-only API routes.
- `connector/` — standalone read-only data service for the trusted host.

@AGENTS.md
