---
name: oracle-connection-diagnosis
description: "How the SILVER_2026 Oracle DB actually connects (TCPS, thin fails, use thick/connector)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7dce39ab-6cc2-474f-8edf-92721076aa2b
---

The SILVER_2026 Oracle DB for the bike-parts dashboard is at `73.149.135.125:8152`, TNS alias `DISH`, user/pass `SILVER_2026`/`SILVER_2026`. Original string used `MSDAORA.1` (legacy thick OCI, Windows-only).

**DB version confirmed by user: Oracle 11g.** This explains all symptoms — node-oracledb thin mode requires 12.1+, so it can never connect; and generic TLS clients fail because 11g's TNS-over-TLS expects Oracle's own OCI client. The right client is **Oracle Instant Client 19c** (the newest that still supports 11.2 servers) in thick mode + the wallet. Note: Apple Silicon has no native 19c Instant Client (ARM64 IC is 23ai, too new for 11g), so on this Mac thick mode needs x86_64 IC 19 under Rosetta — cleanest is to run the backend/connector on the existing machine or a Linux/x86 host.

Verified by direct probing (June 2026): port 8152 is an Oracle **TCPS/TLS** listener (TLS 1.2, self-signed cert `CN=DISHA-C2`, one-way TLS — no client cert required). TLS handshakes fine from a Mac once the cert is trusted (cert saved at `silver-dashboard/certs/DISHA-C2.pem`). BUT the modern pure-JS **"thin" driver login is reset by the server before any reply, identically for every service name/SID** — a protocol-level rejection, not a wrong service name. This is the signature of a **legacy / OCI-only Oracle server**. Port 8151 is also open but resets during TLS init (unusable).

Also tested Oracle's own **JDBC thin driver** (= what SQL Developer uses) via OpenJDK 17 + ojdbc11 21.11 + a PKCS12 truststore holding the server cert: it fails with `IO Error (internal_error) Received fatal alert: internal_error` for every service name/SID, even forcing TLSv1.2 and enabling legacy TLS renegotiation. So **generic TLS clients (node-oracledb, JDBC/SQL Developer, raw OpenSSL+TNS) are all rejected by the server right after the TLS handshake** — only Oracle's own OCI client with the matching wallet completes a session. (Plain `openssl s_client` handshake alone succeeds because it never sends Oracle traffic.)

Conclusion: **cannot connect from this Mac with username/password alone — not via SQL Developer either.** Need either (1) to run from the machine that already connects (has OCI client + wallet + IP trust — SQL Developer/Excel there will work), or (2) the Oracle **wallet** (cwallet.sso/ewallet.p12 + sqlnet.ora) + exact `tnsnames.ora` DISH descriptor + DB version from the developer, then use thick-mode OCI or the bundled read-only connector. Also want a read-only DB user + the report SQL/views. Installed OpenJDK 17 via brew (keg-only at /opt/homebrew/opt/openjdk@17). All access stays read-only. See [[silver-dashboard-project]].
