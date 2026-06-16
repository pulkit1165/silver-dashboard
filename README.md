# Silver Industries — Dashboard

A **read-only** operations dashboard (Next.js) for Silver Industries (bike
parts), backed by the Oracle `SILVER_2026` database.

> Status: the UI is complete and runs today on built-in **sample data**. Wiring
> live data needs one connectivity step (see **Going live**) — by design, this
> app can never write to the database.

## Run it

```bash
npm install
npm run dev
# open http://localhost:3000
```

It starts in sample-data mode, so every page works immediately. The
**Connection** page shows live DB status and the exact steps to go live.

## Read-only by construction

The dashboard cannot modify the database. Four independent guards (see
`lib/oracle.ts`):

1. Only a single `SELECT` / `WITH` statement is accepted; any other keyword is
   rejected before it reaches Oracle.
2. Every statement runs inside `SET TRANSACTION READ ONLY` — Oracle raises
   `ORA-01456` on any attempted write.
3. `autoCommit` is never enabled and `commit()` is never called.
4. A statement timeout (`ORACLE_STMT_TIMEOUT_MS`) and row cap (`ORACLE_MAX_ROWS`)
   keep load off the server.

## The connection situation (important)

We probed the server directly. Findings:

- `73.149.135.125:8152` is an Oracle **TCPS (TLS)** listener (not plaintext).
  TLS 1.2 handshake succeeds; self-signed cert `CN=DISHA-C2`. One-way TLS — no
  client certificate is required.
- The modern pure-JS **"thin" driver login is reset before any reply**, and
  identically for *every* service name/SID — i.e. a protocol-level rejection,
  not a wrong service name.
- This matches a **legacy / OCI-only Oracle server**, consistent with the
  original `MSDAORA.1` provider (a thick-mode OCI interface).

So a direct thin connection from a Mac won't work. The reliable paths are
thick-mode OCI or the bundled connector — both **read-only**.

## Going live (pick one)

All three are read-only. The dashboards switch to live data automatically once
data is reachable **and** `lib/queries.ts` is filled in (use the **Data
Explorer** to discover the real tables first).

**A. Remote connector (recommended, least setup).** Run `connector/serve.mjs`
on the machine that already reaches Oracle today, then set in `.env.local`:

```
REMOTE_DATA_URL=http://<that-host>:8088
```

See [`connector/README.md`](connector/README.md). You can also just run
`connector/discover.mjs` there to dump the schema.

**B. Thick mode on the dashboard host.** Install Oracle Instant Client + a
wallet, then in `.env.local`:

```
ORACLE_CLIENT_LIB_DIR=/opt/oracle/instantclient_19_8
ORACLE_CONFIG_DIR=/opt/oracle/network/admin   # sqlnet.ora + wallet (cwallet.sso)
```

**C. Thin mode** (only if the DBA confirms the server accepts it). Export the
cert before starting so Node trusts it:

```
export NODE_EXTRA_CA_CERTS="$PWD/certs/DISHA-C2.pem"
npm run dev
```

### Fastest unlock: the real `DISH` connect descriptor

The machine that connects today has a `tnsnames.ora` entry for `DISH`. Its exact
`PROTOCOL/HOST/PORT/SERVICE_NAME` (or the service name + Oracle version) removes
all guesswork — drop it into `ORACLE_CONNECT_STRING` / `ORACLE_SERVICE`.

## Project structure

```
app/
  page.tsx              Overview (KPIs, revenue trend, recent orders)
  inventory/            Parts catalogue + stock status
  sales/                Revenue + order trends
  explorer/             Live schema browser + read-only query runner
  connection/           DB status + diagnosis + how to go live
  api/health|schema|query   read-only JSON endpoints
lib/
  oracle.ts             read-only Oracle access (thin/thick/remote) + guards
  data.ts               picks live vs sample data
  queries.ts            <-- map real SQL here after schema discovery
  sample-data.ts        built-in demo dataset
components/             UI (charts, cards, tables)
connector/              standalone read-only data service for the trusted host
certs/DISHA-C2.pem      server's TLS cert (public)
```

## Configuration

Copy `.env.example` to `.env.local` and edit. Key vars: `DATA_SOURCE`
(`auto`/`mock`/`oracle`), the `ORACLE_*` connection settings, `REMOTE_DATA_URL`,
and the safety limits. `.env.local` is gitignored.
