/**
 * Test Oracle connection in thick mode, trying multiple service names.
 * Usage: node connector/test-connection.mjs
 */
import oracledb from "oracledb";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IC_DIR = "C:\\oracle\\instantclient_19_31";
const CONFIG_DIR = "C:\\oracle\\network\\admin";
const USER = "SILVER_2026";
const PASS = "SILVER_2026";
const HOST = "DISHA-C2"; // resolves via hosts file -> 73.149.135.125
const PORT = 8152;

// Service name candidates — most likely first
const SERVICE_CANDIDATES = [
  "ORCL",
  "DISHA",
  "DISHA-C2",
  "SILVER_2026",
  "XE",
  "SILVER",
  "DISHA.localdomain",
  "ORCL.localdomain",
];

function makeConnectString(service) {
  return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=${HOST})(PORT=${PORT}))(CONNECT_DATA=(SERVICE_NAME=${service}))(SECURITY=(SSL_SERVER_DN_MATCH=NO)(SSL_CLIENT_AUTHENTICATION=FALSE)))`;
}

console.log("Initializing Oracle thick mode...");
try {
  oracledb.initOracleClient({ libDir: IC_DIR, configDir: CONFIG_DIR });
  console.log("  Oracle client version:", oracledb.oracleClientVersionString);
} catch (e) {
  console.error("Failed to init Oracle client:", e.message);
  process.exit(1);
}

for (const svc of SERVICE_CANDIDATES) {
  process.stdout.write(`\nTrying SERVICE_NAME=${svc} ... `);
  const cs = makeConnectString(svc);
  try {
    const conn = await oracledb.getConnection({
      user: USER, password: PASS,
      connectString: cs,
      connectTimeout: 10,
    });
    const r = await conn.execute(
      "select banner from v$version where rownum=1",
      [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    console.log("SUCCESS!");
    console.log("  Banner:", r.rows[0]?.BANNER);
    await conn.close();
    console.log(`\n✓ SERVICE_NAME=${svc} is correct.`);
    console.log(`\nUse this ORACLE_CONNECT_STRING in .env.local:\n${cs}`);
    process.exit(0);
  } catch (e) {
    // Print full error details
    const lines = e.message.split("\n").slice(0, 4).join(" | ");
    console.log("FAILED:", lines);
    if (e.errorNum) console.log("  ORA-" + e.errorNum);
    if (e.offset !== undefined) console.log("  offset:", e.offset);
  }
}

console.log("\nAll service name candidates failed.");
console.log("You need the real service name from the developer's tnsnames.ora.");
