// One-time, idempotent setup for the invoicing module. Safe to run on an
// existing database (only inserts when missing; never overwrites your edits).
//   npm run db:invoicing
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = postgres(url, { prepare: false });

// 1) Seller / company master (single row id=1). Bank details are taken from the
//    client's real invoice; CONFIRM the GSTIN + state before going live.
await sql`
  INSERT INTO company_settings (id, legal_name, gstin, state_code, address, city, pincode,
    phone, msme_no, bank_name, bank_account, bank_ifsc, bank_branch, invoice_prefix,
    invoice_next_no, terms)
  VALUES (1, 'SILVER INDUSTRIES', '', '03', 'Feroze Gandhi Market', 'Ludhiana', '',
    '', '', 'HDFC BANK LTD.', '50200032797094', 'HDFC0000634', 'FEROZE GANDHI MARKET, LUDHIANA',
    'GC26/', 228,
    E'1. Goods once sold will not be taken back.\n2. Subject to Ludhiana jurisdiction only.\n3. 18% interest will be charged if the bill is not paid within 30 days.')
  ON CONFLICT (id) DO NOTHING`;

// 2) A starter discount class matching the sample invoice's scheme (60.58% off MRP).
await sql`
  INSERT INTO discount_classes (code, name, whole_order_pct)
  VALUES ('STD', 'Standard (60.58% off MRP)', 60.58)
  ON CONFLICT (code) DO NOTHING`;

// 3) Make sure every SKU has a GST rate (parts default to 18%).
await sql`UPDATE skus SET gst_rate = 18 WHERE gst_rate IS NULL OR gst_rate = 0`;

const [{ count: classes }] = await sql`SELECT COUNT(*)::int AS count FROM discount_classes`;
const [co] = await sql`SELECT legal_name, state_code, invoice_prefix, invoice_next_no FROM company_settings WHERE id=1`;
console.log("Invoicing setup complete.");
console.log(`  Company: ${co?.legal_name} (state ${co?.state_code}) · next invoice ${co?.invoice_prefix}${co?.invoice_next_no}`);
console.log(`  Discount classes: ${classes}`);
console.log("  → Assign a discount class + state code/POS to customers in the Customers screen.");
await sql.end();
