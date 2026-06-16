---
name: silver-dashboard-project
description: "What the Silver Industries dashboard is, where it lives, and how data flows"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7dce39ab-6cc2-474f-8edf-92721076aa2b
---

Read-only operations dashboard for Silver Industries (bike parts), backed by the Oracle `SILVER_2026` DB. Built with **Next.js 16 (App Router, Turbopack, React 19, Tailwind v4, TypeScript)** at `/Users/pulkitsharma/Desktop/silver industries/silver-dashboard/` (subfolder because the parent dir name has a space, which breaks npm package naming).

Architecture: a strictly **read-only** data layer (`lib/oracle.ts`) with four write-guards (SELECT/WITH only, `SET TRANSACTION READ ONLY`, never commit, statement timeout + row cap). `lib/data.ts` swaps between live Oracle and built-in sample data (`lib/sample-data.ts`) so the UI always renders; it currently runs on **sample data** because of [[oracle-connection-diagnosis]]. Live domain SQL must be filled into `lib/queries.ts` after discovering the real schema via the Explorer page or `connector/discover.mjs`.

Three ways to go live (all read-only): (A) `REMOTE_DATA_URL` → run `connector/serve.mjs` on the trusted host; (B) thick mode via `ORACLE_CLIENT_LIB_DIR` + `ORACLE_CONFIG_DIR` (wallet); (C) thin mode only if DBA confirms support. Pages: Overview, Inventory, Sales, Data Explorer (schema browser + read-only query runner), Connection (status + diagnosis). User chose Next.js single-app; backend host still undecided.
