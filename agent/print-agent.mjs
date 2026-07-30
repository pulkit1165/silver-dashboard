// Silver ERP — self-hosted print agent (PrintNode replacement).
//
// Runs on each Windows PC that has TSC label printers. It polls the ERP web app
// over HTTPS (outbound only — no tunnel / port-forward), claims queued jobs for
// this PC's printers, and prints the raw TSPL via the Windows spooler (rawprint.ps1).
//
// Node 16+ compatible (uses the built-in https module, not global fetch).
//
// Setup: copy config.example.json → config.json, fill baseUrl + token, then:
//   node print-agent.mjs
// (See README.md for auto-start on login.)

import https from "https";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { URL, fileURLToPath } from "url";
import { spawnSync } from "child_process";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ── config ──────────────────────────────────────────────────────────────────
function loadConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8")); } catch { /* fall back to env */ }
  const c = {
    baseUrl: file.baseUrl || process.env.SILVER_BASE_URL || "",
    token: file.token || process.env.PRINT_AGENT_TOKEN || "",
    pc: file.pc || process.env.SILVER_PC || os.hostname(),
    printers: Array.isArray(file.printers) ? file.printers : [],
    printerFilter: file.printerFilter != null ? String(file.printerFilter) : "TSC",
    pollMs: Number(file.pollMs) || 1000,
    heartbeatMs: Number(file.heartbeatMs) || 10000,
  };
  if (!c.baseUrl || !c.token) {
    console.error("[agent] Missing baseUrl or token. Edit config.json (copy config.example.json).");
    process.exit(1);
  }
  c.baseUrl = c.baseUrl.replace(/\/+$/, "");
  return c;
}
const cfg = loadConfig();

// ── tiny JSON POST (Node 16, no global fetch) ────────────────────────────────
function postJSON(pathname, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(cfg.baseUrl + pathname);
    const data = Buffer.from(JSON.stringify(body));
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443),
      path: u.pathname + u.search, method: "POST",
      headers: { "content-type": "application/json", "content-length": data.length, "x-agent-token": cfg.token },
    }, (res) => {
      let s = ""; res.on("data", (d) => (s += d));
      res.on("end", () => { try { resolve({ status: res.statusCode, json: s ? JSON.parse(s) : {} }); } catch { resolve({ status: res.statusCode, json: {} }); } });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("request timeout")));
    req.write(data); req.end();
  });
}

// ── discover installed Windows printers ──────────────────────────────────────
function detectPrinters() {
  if (cfg.printers.length) return cfg.printers;
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"], { encoding: "utf8" });
    const all = (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const f = cfg.printerFilter.toLowerCase();
    return f ? all.filter((n) => n.toLowerCase().includes(f)) : all;
  } catch { return []; }
}

// ── raw print via the spooler helper ─────────────────────────────────────────
function rawPrint(printerName, bytes) {
  const tmp = path.join(os.tmpdir(), `silver_${Date.now()}_${Math.floor(Math.random() * 1e6)}.bin`);
  fs.writeFileSync(tmp, bytes);
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(DIR, "rawprint.ps1"), "-Printer", printerName, "-File", tmp], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(((r.stderr || r.stdout || "powershell failed").trim()).slice(0, 300));
  } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}

// ── loops ────────────────────────────────────────────────────────────────────
let printers = detectPrinters();
console.log(`[agent] PC=${cfg.pc}  serving:`, printers.length ? printers.join(", ") : "(none found — check printerFilter or list them in config.printers)");

async function heartbeat() {
  printers = detectPrinters();
  try {
    const r = await postJSON("/api/erp/print/agent/heartbeat", { pc: cfg.pc, printers });
    if (r.status !== 200) console.error("[agent] heartbeat", r.status, JSON.stringify(r.json));
  } catch (e) { console.error("[agent] heartbeat error:", e.message); }
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const r = await postJSON("/api/erp/print/agent/pull", { pc: cfg.pc, limit: 10 });
    if (r.status !== 200) { if (r.status !== 401) console.error("[agent] pull", r.status, JSON.stringify(r.json)); return; }
    const jobs = (r.json && r.json.jobs) || [];
    for (const j of jobs) {
      try {
        rawPrint(j.name, Buffer.from(j.tspl_b64, "base64"));
        await postJSON("/api/erp/print/agent/ack", { id: j.id, ok: true });
        console.log(`[agent] printed job ${j.id} → ${j.name}`);
      } catch (e) {
        await postJSON("/api/erp/print/agent/ack", { id: j.id, ok: false, error: e.message });
        console.error(`[agent] job ${j.id} FAILED:`, e.message);
      }
    }
  } catch (e) { console.error("[agent] poll error:", e.message); }
  finally { polling = false; }
}

heartbeat();
setInterval(heartbeat, cfg.heartbeatMs);
setInterval(poll, cfg.pollMs);
console.log(`[agent] running. Polling ${cfg.baseUrl} every ${cfg.pollMs}ms.`);
