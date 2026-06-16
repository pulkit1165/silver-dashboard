// One-shot, read-only schema discovery. Connects, lists tables + columns +
// row counts, prints a summary, and writes schema.json. This is the fastest
// way to learn the SILVER_2026 data model so lib/queries.ts can be filled in.
import fs from "node:fs";
import { ping, listTables, describeTable, closePool } from "./oracle.mjs";

async function main() {
  const health = await ping();
  if (!health.ok) {
    console.error("Could not connect:", health.error);
    process.exit(1);
  }
  console.log("Connected ✓", health.banner || "");

  const tables = await listTables();
  console.log(`\nFound ${tables.length} table(s):\n`);

  const schema = [];
  for (const t of tables) {
    let columns = [];
    try {
      columns = await describeTable(t.table);
    } catch (e) {
      console.warn(`  (could not describe ${t.table}: ${e.message})`);
    }
    schema.push({ ...t, columns });
    const cols = columns.map((c) => c.name).join(", ");
    console.log(
      `• ${t.table}  [${t.rows ?? "?"} rows]\n    ${cols.slice(0, 160)}${cols.length > 160 ? "…" : ""}`,
    );
  }

  fs.writeFileSync("schema.json", JSON.stringify({ banner: health.banner, tables: schema }, null, 2));
  console.log(`\nWrote schema.json (${schema.length} tables).`);
  await closePool().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
