# Silver Industries — Read-only Connector

A tiny, **strictly read-only** Oracle connector. Run it on the machine that
already connects to `SILVER_2026` today (it has the Oracle client, wallet, and
network/IP trust). Two uses:

1. **`discover.mjs`** — dump the schema (tables, columns, row counts) so we can
   map the dashboard's real queries.
2. **`serve.mjs`** — expose a read-only HTTP API the dashboard can use remotely
   (`REMOTE_DATA_URL`), so the UI can run anywhere while the DB stays put.

## Why this exists

From a Mac, the database (an Oracle **TCPS/TLS** listener on `:8152`) accepts
TLS but **resets the modern "thin" driver login before replying**, for every
service name. That's the signature of a legacy / OCI-only server — the same one
the original `MSDAORA.1` connection string targets. Thick-mode OCI (an installed
Oracle client + wallet) is the reliable way in, and that already exists on the
machine that works today. Run this there.

## Safety

This connector can **never** modify the database:

- Only a single `SELECT` / `WITH` statement is accepted (everything else is
  rejected before it reaches Oracle).
- Every statement runs inside `SET TRANSACTION READ ONLY` — Oracle itself raises
  `ORA-01456` on any attempted write.
- `autoCommit` is never enabled and `commit()` is never called.
- A statement timeout and row cap keep load off the server.

## Setup

```bash
cd connector
npm install
cp .env.example .env        # edit credentials
# copy the TLS cert next to this folder (already in ../certs/DISHA-C2.pem)
cp ../certs/DISHA-C2.pem ./DISHA-C2.pem
```

### Thick mode (recommended / likely required)

1. Install Oracle Instant Client (Basic) for the OS/arch of this machine.
   - On the existing Windows box you may already have a full Oracle client — in
     that case just set `ORACLE_CLIENT_LIB_DIR` to its `bin`/lib folder.
2. Put `sqlnet.ora` + the wallet (`cwallet.sso`) in a folder and set
   `ORACLE_CONFIG_DIR` to it. A minimal `sqlnet.ora`:
   ```
   WALLET_LOCATION=(SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY="/path/to/wallet")))
   SSL_SERVER_DN_MATCH=no
   ```
3. Set `ORACLE_CLIENT_LIB_DIR` (and `ORACLE_CONFIG_DIR`) in `.env`.

> If the existing machine already has a working `tnsnames.ora` entry for `DISH`,
> set `ORACLE_CONNECT_STRING` to that descriptor (or `ORACLE_SERVICE` to the
> service name it uses) — that removes all guesswork.

## Run

```bash
# Discover the schema (writes schema.json)
npm run discover

# Or start the read-only HTTP service
npm run serve
# -> http://0.0.0.0:8088   (set CONNECTOR_TOKEN to require a bearer token)
```

Then in the dashboard's `.env.local`:

```
REMOTE_DATA_URL=http://<this-host>:8088
# if you set a token:
# REMOTE_DATA_TOKEN is not used by the UI yet — keep the service on a trusted network,
# or front it with the token and a reverse proxy.
```

## Endpoints

| Method | Path             | Returns                                            |
| ------ | ---------------- | -------------------------------------------------- |
| GET    | `/health`        | `{ ok, banner }`                                   |
| GET    | `/schema`        | `{ tables: [{ owner, table, rows }] }`             |
| GET    | `/schema/:table` | `{ table, columns: [{ name, type, nullable }] }`   |
| POST   | `/query`         | `{ columns, rows, rowCount, elapsedMs, truncated }`|
