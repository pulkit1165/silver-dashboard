// One-time: copy every APPROVED label design into its abbreviation-sticker
// counterpart (same tables, same pipeline — see lib/erp/labelDesign.ts /
// stickerSizes.ts — sticker designs are just label_designs rows keyed
// "sticker-<sizeId>"). Only touches brand-new sticker-* rows; never modifies
// the original label design it copies from.
//
// Field remap: header -> abbr1, name -> abbr2 (matches the sticker module's
// ITEMS MASTER convention: abbr1 = "Label Desc.", abbr2 = "Label Desc.1").
// Every other element (code/qr/mrp/qty/lot/rack/pkd/incltax/line) is copied
// unchanged — those fields mean the same thing in both modules.
//
// Usage:
//   node scripts/copy-labels-to-stickers.mjs            # dry run (default)
//   node scripts/copy-labels-to-stickers.mjs --write     # actually write
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
const DB_URL = process.env.DATABASE_URL || process.env.ORACLE_RAW_DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set in .env.local"); process.exit(1); }
const WRITE = process.argv.includes("--write");

const sql = postgres(DB_URL, { prepare: false });

function remapDoc(doc) {
  const elements = doc.elements.map((el) => {
    if (el.field === "header") return { ...el, field: "abbr1" };
    if (el.field === "name") return { ...el, field: "abbr2" };
    return el;
  });
  return { ...doc, elements };
}

async function main() {
  const rows = await sql`
    SELECT size_id, w, h, approved_doc FROM label_designs
    WHERE status = 'approved' AND approved_doc IS NOT NULL AND size_id NOT LIKE 'sticker-%'
    ORDER BY size_id`;

  console.log(`Mode: ${WRITE ? "WRITE" : "DRY RUN (no writes)"}`);
  console.log(`Found ${rows.length} approved label design(s) to copy:\n`);

  for (const row of rows) {
    const stickerSizeId = `sticker-${row.size_id}`;
    const [existing] = await sql`SELECT status FROM label_designs WHERE size_id = ${stickerSizeId}`;
    const remapped = remapDoc(row.approved_doc);
    const fieldsBefore = row.approved_doc.elements.map((e) => e.field).filter(Boolean).join(", ");
    const fieldsAfter = remapped.elements.map((e) => e.field).filter(Boolean).join(", ");

    console.log(`${row.size_id} -> ${stickerSizeId}`);
    console.log(`  fields before: ${fieldsBefore}`);
    console.log(`  fields after:  ${fieldsAfter}`);
    if (existing) {
      console.log(`  SKIPPED — ${stickerSizeId} already exists (status=${existing.status}); not overwriting.`);
      continue;
    }
    if (!WRITE) { console.log(`  (dry run — would insert)`); continue; }

    await sql`
      INSERT INTO label_designs (size_id, w, h, draft_doc, approved_doc, status, updated_by, approved_by, approved_at)
      VALUES (${stickerSizeId}, ${row.w}, ${row.h}, ${sql.json(remapped)}, ${sql.json(remapped)}, 'approved', 'copy-labels-to-stickers', 'copy-labels-to-stickers', now())
      ON CONFLICT (size_id) DO NOTHING`;
    console.log(`  -> inserted as approved.`);
  }

  await sql.end();
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
