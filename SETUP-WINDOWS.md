# Running this on Windows (and connecting to Oracle 11g)

This is the recommended environment, because the **Oracle 11g client on Windows**
uses Oracle's own connection software — the piece that a Mac/generic driver
can't provide for an 11g + TLS server.

## 1. Install the basics
- **Node.js LTS** (https://nodejs.org) — gives `node` and `npm`.
- **Git** (https://git-scm.com).
- **Claude Code** for Windows (so the assistant continues here with full context;
  `CLAUDE.md` loads automatically when you open this folder).

## 2. Get the project
```powershell
git clone <your-repo-url> silver-dashboard
cd silver-dashboard
npm install
copy .env.example .env.local   # then edit values (see below)
npm run dev                    # http://localhost:3000  (sample data for now)
```
Open the folder in Claude Code and it will already know the full history.

## 3. Install an Oracle client that supports 11g
Pick one:
- **Oracle Instant Client 19c** (Basic) for Windows x64 — supports 11g servers, or
- the **full Oracle 11g/12c client** if the existing machine already has one.

Set `TNS_ADMIN` to a folder that will hold the network config (next step), e.g.
`C:\oracle\network\admin`.

## 4. Configure the connection (read-only)
In your `TNS_ADMIN` folder create:

**`tnsnames.ora`** — ideally paste the real `DISH` entry from the developer. If
you have to build it, it looks like:
```
DISH =
 (DESCRIPTION =
   (ADDRESS = (PROTOCOL = TCPS)(HOST = 73.149.135.125)(PORT = 8152))
   (CONNECT_DATA = (SERVICE_NAME = <REAL_SERVICE_NAME>))
 )
```
> `<REAL_SERVICE_NAME>` is the one thing we still need — it's in the developer's
> `tnsnames.ora`. Ask him for the full `DISH` entry.

**`sqlnet.ora`**
```
WALLET_LOCATION = (SOURCE = (METHOD = FILE)(METHOD_DATA = (DIRECTORY = C:\oracle\wallet)))
SSL_SERVER_DN_MATCH = no
SQLNET.AUTHENTICATION_SERVICES = (TCPS)
SSL_CLIENT_AUTHENTICATION = FALSE
```

**Wallet** (to trust the server's self-signed cert — we already captured it at
`certs/DISHA-C2.pem`). With the Oracle client's `orapki`:
```powershell
orapki wallet create -wallet C:\oracle\wallet -pwd <walletPwd> -auto_login
orapki wallet add -wallet C:\oracle\wallet -trusted_cert -cert path\to\DISHA-C2.pem -pwd <walletPwd>
```

## 5. Test the connection
```powershell
sqlplus SILVER_2026/<password>@DISH
SQL> select banner from v$version;     -- should print Oracle 11g
```
If that works, you're in. (Keep it read-only — only `SELECT`.)

## 6. Wire the dashboard to live data
Two ways (both read-only):
- **In-app thick mode** — in `.env.local`:
  ```
  ORACLE_CLIENT_LIB_DIR=C:\path\to\instantclient_19_x
  ORACLE_CONFIG_DIR=C:\oracle\network\admin
  ORACLE_USER=SILVER_2026
  ORACLE_PASSWORD=<password>
  ORACLE_CONNECT_STRING=DISH
  ```
- **Connector service** — `cd connector && npm install && npm run serve`, then set
  `REMOTE_DATA_URL=http://localhost:8088` in the dashboard `.env.local`.

Then map the real SQL in `lib/queries.ts` / `OPS_QUERIES` (use the Data Explorer
page or `node connector/discover.mjs` to find the tables/views). The screens flip
to live data automatically.

## Notes
- `.env.local` is not in git — recreate it on Windows (copy from `.env.example`).
- The server cert is in `certs/DISHA-C2.pem` (safe to keep; it's public).
