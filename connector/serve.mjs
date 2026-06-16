// Read-only HTTP data service. Run this on a host that can reach Oracle; point
// the dashboard at it with REMOTE_DATA_URL=http://this-host:PORT
//
// Endpoints (all read-only):
//   GET  /health            -> { ok, banner }
//   GET  /schema            -> { tables: [...] }
//   GET  /schema/:table     -> { table, columns: [...] }
//   POST /query  {sql}      -> { columns, rows, rowCount, elapsedMs, truncated }
import http from "node:http";
import { ping, listTables, describeTable, runQuery, closePool } from "./oracle.mjs";

const PORT = Number(process.env.CONNECTOR_PORT || 8088);
const HOST = process.env.CONNECTOR_HOST || "0.0.0.0";
const TOKEN = process.env.CONNECTOR_TOKEN || ""; // optional shared secret
const ORIGIN = process.env.CONNECTOR_CORS_ORIGIN || "*";

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});

    if (TOKEN) {
      const auth = req.headers["authorization"] || "";
      if (auth !== `Bearer ${TOKEN}`) return send(res, 401, { error: "Unauthorized" });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (req.method === "GET" && path === "/health") {
      return send(res, 200, await ping());
    }
    if (req.method === "GET" && path === "/schema") {
      return send(res, 200, { tables: await listTables() });
    }
    if (req.method === "GET" && path.startsWith("/schema/")) {
      const t = decodeURIComponent(path.slice("/schema/".length));
      return send(res, 200, { table: t, columns: await describeTable(t) });
    }
    if (req.method === "POST" && path === "/query") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.sql) return send(res, 400, { error: "Provide { sql }" });
      return send(res, 200, await runQuery(body.sql));
    }
    return send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[connector] read-only data service on http://${HOST}:${PORT}`);
  if (!TOKEN) console.log("[connector] WARNING: no CONNECTOR_TOKEN set — anyone who can reach this port can run SELECTs.");
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await closePool().catch(() => {});
    process.exit(0);
  });
}
