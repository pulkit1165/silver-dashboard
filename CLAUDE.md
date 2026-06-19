# Silver Industries Dashboard — project context (read this first)

Read-only **Next.js** reporting dashboard for Silver Industries (bike parts),
backed by an **Oracle 11g** database (`SILVER_2026`). This file is the handoff so
a new Claude Code session — including on a different computer — continues exactly
where we left off.

## Current status
- UI is complete. Premium **white + red** theme (Manrope font), modeled on
  the TransfersX dashboard.
- The **Home** screen mirrors the client's legacy app: SALE, PURCHASE,
  RECEIVABLE, BANK BALANCE, TOTAL DR/CR, with a DATE/DAY header, Refresh button,
  Sale-Purchase / Stock tabs, and a KPI strip.
- **Connected to live Oracle as of 2026-06-20** (`/api/health` confirms real
  DB banner) — but the Home screen's actual figures are still
  `lib/sample-data.ts` placeholders, because the real SQL hasn't been mapped
  into `lib/queries.ts` yet. See "Oracle connection" below for the full
  architecture and "Remaining work" for the one task left.

## Oracle connection — LIVE as of 2026-06-20 (read this carefully)
- DB: **Oracle 11g** (11.2.0.4.0 Enterprise Edition), schema `SILVER_2026`,
  TNS alias/service name `DISH`. Real server is at `73.149.135.125:8152`
  (TCPS) — but we do **not** connect that way; see below.
- **Root cause found:** Oracle 19c/21c Instant Client cannot connect to this
  Oracle 11g server over TCPS — the server sends a TLS `internal_error` fatal
  alert right after the client's TNS CONNECT packet (protocol-version
  mismatch: client sends v318, 11g doesn't handle it over TCPS). Confirmed
  with node-oracledb thin, thick (19c), JDBC, SQL Developer — all rejected the
  same way. Oracle 11g/12c-era clients work fine; nothing 18c+ does over TCPS.
- **The working setup (current architecture):** the Oracle 11g **database
  itself runs on a Windows Server 2012 R2 machine** (the client's server,
  reachable via RDP at `73.149.135.125`, account `pulkit`, **non-admin**).
  `tnsnames.ora` there resolves `DISH` to `localhost:1521` over **plain TCP**
  (no TLS at all) — so the version-mismatch problem disappears entirely for a
  *local* connection. We run the read-only `connector/` **on that server**,
  pointed at a freshly-downloaded Oracle 19c Instant Client (also on that
  server, since node-oracledb 7/5/4/3 all refuse to talk to the 11.2 client
  libraries — they require Oracle Client 18.1+ minimum), talking to Oracle
  over localhost TCP. The dashboard (anywhere) reaches that connector through
  an HTTPS tunnel (`REMOTE_DATA_URL`), since the server's router only forwards
  port 8152 (Oracle) — not whatever port the connector uses.
- Login: SILVER_2026 / SILVER_2026.

### Exact paths on the server (Windows Server 2012 R2, `73.149.135.125`)
- Oracle DB home: `D:\app\product\11.2.0\dbhome_1` (listener binary, tnsnames,
  `lsnrctl`). Also an old Oracle 10g client at `D:\oracle\product\10.2.0\client_1`
  (unused by us).
- Our connector: `D:\connector2\` (oracle.mjs, serve.mjs, package.json —
  plain copies of `connector/`, not a git checkout). `node_modules` here has
  **oracledb@5** installed (has `initOracleClient()`; oracledb 4/3 also work
  but lack ESM niceties — 5 is what's currently installed).
- Oracle 19c Instant Client (downloaded fresh, not the same as this repo's
  `C:\oracle\instantclient_19_31` which is on the Windows 11 dev PC, not the
  server): `D:\instantclient_19_31\instantclient_19_31\` (note the **doubled**
  folder — the zip extracts a nested `instantclient_19_31` subfolder; the
  actual `oci.dll` is one level deeper than you'd expect).
- Node.js **16.20.2** is installed on the server — Node 18+ throws a hard
  compatibility warning on Windows Server 2012 R2 and is unreliable there.
- `lsnrctl status` lives at `D:\app\product\11.2.0\dbhome_1\bin\lsnrctl.exe`.
  **If the ERP on the 10 client PCs ever shows "TNS not listening,"** RDP in
  and run `D:\app\product\11.2.0\dbhome_1\bin\lsnrctl start`. This happened
  once during testing (cause unclear, possibly unrelated) — always check
  `lsnrctl status` (look for service "DISH" status READY) before AND after
  touching anything on that server.

### Persistence (fragile — read before assuming it "just works")
- `D:\connector2\run-persistent.bat` starts the connector (port 8151) +
  `npx localtunnel --port 8151`, logging output to `connector.log` /
  `tunnel.log` in the same folder (both run minimized/hidden).
- Auto-start is wired via a **per-user registry Run key** (`HKCU\Software\
  Microsoft\Windows\CurrentVersion\Run\SilverConnector`) — **not** a Windows
  Service or Scheduled Task, because the `pulkit` account has no admin rights
  and Task Scheduler itself denied every attempt (even `/sc onlogon` with no
  stored credentials). This means:
  - ✅ Survives RDP **disconnect** (closing the RDP window without logging off)
    — the Windows session and its processes keep running in the background.
  - ❌ Does **not** survive a full **log off** or **server reboot** — the Run
    key only fires the next time `pulkit` actually logs back in.
  - ❌ **The tunnel URL changes every time it restarts** (free localtunnel
    gives a new random subdomain each run). When that happens, `REMOTE_DATA_URL`
    in both `.env.local` (dev) and Vercel's env vars (prod) goes stale and the
    site silently falls back to sample data until someone RDPs in, reads the
    new URL from `D:\connector2\tunnel.log`, and updates both places.
  - To make this properly durable later, we need either admin rights on that
    server (to install a real Windows Service + a *named* Cloudflare Tunnel
    with a fixed hostname), or the client's router admin to forward a port
    (e.g. 8088) so we can drop the tunnel entirely.
- Current live tunnel URL (**will go stale on next restart** — check
  `D:\connector2\tunnel.log` if the site stops showing live data):
  `https://stale-emus-flash.loca.lt`

## How to go live (all strictly read-only) — DONE, see above. Remaining work:
1. **Map real SQL.** Connection is live (`/api/health` confirms real Oracle
   11g banner; Vercel home screen shows "Connected to Oracle ✓" but still
   "sample figures" banner). Use the **Data Explorer** page to browse real
   table names (the `listTables`/`describeTable` queries were already fixed
   for 11g — see below), then fill `lib/queries.ts` (`QUERIES` +
   `OPS_QUERIES`) with real SQL against those tables. This is the one
   concrete task left to make the dashboards show real numbers instead of
   sample data.
2. Oracle 11g doesn't support `FETCH FIRST n ROWS ONLY` (12c+ only) — already
   fixed in both `lib/oracle.ts` and `connector/oracle.mjs` to use a
   `rownum <=` subquery instead. Keep this in mind for any *new* SQL written
   against this database — 11g syntax only (no `FETCH FIRST`, no `LISTAGG`
   improvements from 12c, etc).

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
