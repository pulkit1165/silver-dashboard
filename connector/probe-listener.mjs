/**
 * Probe the Oracle TCPS listener to discover registered service names.
 * Sends a TNS CONNECT with COMMAND=status after the TLS handshake.
 * Usage: node connector/probe-listener.mjs
 */
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = "73.149.135.125";
const PORT = 8152;
const certPath = path.join(__dirname, "../certs/DISHA-C2.pem");

// Build a TNS CONNECT packet with COMMAND=status
function buildStatusPacket() {
  const connectData = "(CONNECT_DATA=(COMMAND=status))";
  const cdBuf = Buffer.from(connectData, "ascii");

  // TNS CONNECT packet fixed header (26 bytes) + variable connect data
  const packetLen = 8 + 26 + cdBuf.length; // TNS header + connect header + data
  const buf = Buffer.alloc(packetLen, 0);

  // TNS Header (8 bytes)
  buf.writeUInt16BE(packetLen, 0);  // total length
  buf.writeUInt16BE(0, 2);           // checksum
  buf[4] = 0x01;                     // type: CONNECT
  buf[5] = 0x00;                     // reserved
  buf.writeUInt16BE(0, 6);           // header checksum

  // CONNECT body (26 bytes fixed)
  buf.writeUInt16BE(0x0136, 8);      // version (310 = 12.2 format)
  buf.writeUInt16BE(0x012c, 10);     // version compat (300)
  buf.writeUInt16BE(0x0c41, 12);     // service options
  buf.writeUInt16BE(0x0800, 14);     // session data unit size (2048)
  buf.writeUInt16BE(0x7fff, 16);     // max transmit data unit
  buf.writeUInt16BE(0x0000, 18);     // NT characteristics
  buf.writeUInt16BE(0x0000, 20);     // line turnaround
  buf.writeUInt16BE(0x0001, 22);     // value of 1 in hardware
  buf.writeUInt16BE(cdBuf.length, 24); // length of connect data
  buf.writeUInt16BE(8 + 26, 26);    // offset to connect data
  buf.writeUInt32BE(0x00000800, 28); // max receivable connect data
  buf[32] = 0x41;                    // connect flags 0
  buf[33] = 0x41;                    // connect flags 1

  // Connect data
  cdBuf.copy(buf, 8 + 26);
  return buf;
}

function tryProbe() {
  return new Promise((resolve) => {
    const caRaw = fs.existsSync(certPath) ? fs.readFileSync(certPath) : undefined;
    const options = {
      host: HOST, port: PORT,
      rejectUnauthorized: !!caRaw,
      ca: caRaw,
      timeout: 8000,
    };

    const chunks = [];
    const sock = tls.connect(options, () => {
      console.log("TLS connected, sending TNS status packet...");
      sock.write(buildStatusPacket());
    });

    sock.on("data", (d) => { chunks.push(d); });
    sock.on("end", () => {
      const raw = Buffer.concat(chunks);
      console.log("\nResponse bytes:", raw.toString("hex"));
      console.log("Response text:", raw.toString("latin1").replace(/[^\x20-\x7e]/g, "."));
      resolve(raw);
    });
    sock.on("error", (e) => { console.error("Socket error:", e.message); resolve(null); });
    sock.setTimeout(8000, () => {
      console.log("Timeout — dumping received so far:");
      const raw = Buffer.concat(chunks);
      if (raw.length) {
        console.log("Bytes:", raw.toString("hex"));
        console.log("Text:", raw.toString("latin1").replace(/[^\x20-\x7e]/g, "."));
      } else {
        console.log("(nothing received)");
      }
      sock.destroy();
      resolve(raw);
    });
  });
}

// Also try a simpler RESYNC packet (type 11) which some listeners respond to
function tryResync() {
  return new Promise((resolve) => {
    const caRaw = fs.existsSync(certPath) ? fs.readFileSync(certPath) : undefined;
    const options = {
      host: HOST, port: PORT,
      rejectUnauthorized: false,
      ca: caRaw,
      timeout: 8000,
    };

    const buf = Buffer.alloc(8, 0);
    buf.writeUInt16BE(8, 0);
    buf[4] = 0x0b; // RESYNC

    const chunks = [];
    const sock = tls.connect(options, () => {
      console.log("\n--- RESYNC probe ---");
      sock.write(buf);
    });
    sock.on("data", (d) => { chunks.push(d); });
    sock.on("end", () => { resolve(Buffer.concat(chunks)); });
    sock.on("error", (e) => { console.error("RESYNC error:", e.message); resolve(null); });
    sock.setTimeout(5000, () => {
      const raw = Buffer.concat(chunks);
      if (raw.length) {
        console.log("RESYNC response:", raw.toString("hex"));
        console.log("RESYNC text:", raw.toString("latin1").replace(/[^\x20-\x7e]/g, "."));
      }
      sock.destroy(); resolve(raw);
    });
  });
}

console.log(`Probing Oracle listener at ${HOST}:${PORT} ...\n`);
await tryProbe();
await tryResync();
console.log("\nDone.");
