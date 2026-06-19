/**
 * Grab the Oracle TCPS server certificate and save it as PEM.
 * Usage: node connector/grab-cert.mjs
 */
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = "73.149.135.125";
const PORT = 8152;

function grabCert() {
  return new Promise((resolve, reject) => {
    const sock = tls.connect(
      { host: HOST, port: PORT, rejectUnauthorized: false, timeout: 10000 },
      () => {
        const cert = sock.getPeerCertificate(true);
        sock.destroy();
        resolve(cert);
      }
    );
    sock.on("error", reject);
    sock.setTimeout(10000, () => { sock.destroy(); reject(new Error("Timeout")); });
  });
}

function derToPem(der) {
  const b64 = Buffer.from(der).toString("base64");
  const lines = b64.match(/.{1,64}/g).join("\n");
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`;
}

const cert = await grabCert();
console.log("Subject:", cert.subject);
console.log("Issuer:", cert.issuer);
console.log("Valid from:", cert.valid_from);
console.log("Valid to:", cert.valid_to);
console.log("Fingerprint:", cert.fingerprint);

const pem = derToPem(cert.raw);

// Save to certs/ dir (gitignored but we need it locally)
const certsDir = path.join(__dirname, "../certs");
fs.mkdirSync(certsDir, { recursive: true });
const outPath = path.join(certsDir, "DISHA-C2.pem");
fs.writeFileSync(outPath, pem);
console.log("\nCert saved to:", outPath);
console.log(pem);
