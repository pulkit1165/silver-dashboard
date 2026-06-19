import postgres from "postgres";
import crypto from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const genToken = (p = "SQR") => `${p}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
const sql = postgres(url, { prepare: false });

const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users`;
if (count > 0) {
  console.log(`Seed skipped — ${count} users already present.`);
  await sql.end();
  process.exit(0);
}

await sql.begin(async (sql) => {
  const users = [
    ["Admin User", "admin@silver.local", "admin"],
    ["Sandeep (Sales)", "sales@silver.local", "sales"],
    ["Priya (Purchase)", "purchase@silver.local", "purchase"],
    ["Ravi (Warehouse)", "warehouse@silver.local", "warehouse"],
    ["Dev (Dispatch)", "dispatch@silver.local", "dispatch"],
    ["Anita (Accounts)", "accounts@silver.local", "accounts"],
    ["Viewer", "viewer@silver.local", "viewer"],
  ];
  for (const [name, email, role] of users)
    await sql`INSERT INTO users (name,email,role) VALUES (${name},${email},${role})`;

  const [whMain] = await sql`INSERT INTO warehouses (code,name,address) VALUES ('WH-MAIN','Main Warehouse','Plot 12, Industrial Area') RETURNING id`;
  const [whNorth] = await sql`INSERT INTO warehouses (code,name,address) VALUES ('WH-NORTH','North Depot','Sector 8, North Hub') RETURNING id`;

  const bins = [];
  for (const wh of [whMain.id, whNorth.id])
    for (const r of ["A", "B"])
      for (const s of ["1", "2"]) {
        const [b] = await sql`INSERT INTO bins (warehouse_id,code,rack,shelf,bin) VALUES (${wh},${r + s},${r},${s},${r + s + "-01"}) RETURNING id`;
        bins.push(b.id);
      }

  const skuData = [
    ["BRK-PAD-001", "Front Brake Pad Set", "Brakes", "SilverPro", 450, 20, 40],
    ["BRK-DISC-002", "Brake Disc Rotor 240mm", "Brakes", "SilverPro", 1200, 10, 20],
    ["CHN-520-003", "Drive Chain 520 x 120L", "Transmission", "ChainMax", 980, 15, 30],
    ["SPR-REAR-004", "Rear Sprocket 45T", "Transmission", "ChainMax", 760, 12, 24],
    ["CLT-PLT-005", "Clutch Plate Kit", "Engine", "MotoCore", 1450, 8, 16],
    ["MIR-LH-006", "Side Mirror LH", "Body", "ClearView", 320, 25, 50],
    ["MIR-RH-007", "Side Mirror RH", "Body", "ClearView", 320, 25, 50],
    ["FLT-OIL-008", "Oil Filter", "Engine", "MotoCore", 180, 40, 80],
    ["FLT-AIR-009", "Air Filter", "Engine", "MotoCore", 240, 30, 60],
    ["BLB-HEAD-010", "Headlight Bulb H4", "Electrical", "BrightWay", 150, 50, 100],
    ["BAT-12V-011", "Battery 12V 9Ah", "Electrical", "PowerCell", 2200, 6, 12],
    ["TYR-90-012", "Tyre 90/90-17", "Wheels", "GripX", 1850, 10, 20],
  ];
  const skuIds = [];
  for (const s of skuData) {
    const [row] = await sql`
      INSERT INTO skus (sku_code,name,category,brand,unit,price,min_stock,reorder_level,qr_token)
      VALUES (${s[0]},${s[1]},${s[2]},${s[3]},'PCS',${s[4]},${s[5]},${s[6]},${genToken()}) RETURNING id`;
    skuIds.push(row.id);
  }

  for (let i = 0; i < skuIds.length; i++) {
    const id = skuIds[i];
    const bin = bins[i % bins.length];
    const qty = i === 4 ? 3 : i === 10 ? 4 : 30 + ((i * 7) % 50);
    await sql`INSERT INTO inventory (sku_id,warehouse_id,bin_id,batch,qty) VALUES (${id},${whMain.id},${bin},'',${qty})`;
    await sql`INSERT INTO stock_moves (sku_id,warehouse_id,bin_id,type,qty,ref_doc,note,user_id) VALUES (${id},${whMain.id},${bin},'opening',${qty},'OPENING','Opening stock',1)`;
  }

  const vendors = [
    ["V-001", "SilverPro Components", "29ABCDE1234F1Z5", "Mr. Mehta", "sales@silverpro.in", "+91 98200 11111", "Brakes", "Net 30", 4.5, "approved"],
    ["V-002", "ChainMax Industries", "27PQRST5678G2Z3", "Ms. Rao", "info@chainmax.in", "+91 98200 22222", "Transmission", "Net 45", 4.1, "approved"],
    ["V-003", "MotoCore Engine Parts", "24LMNOP9012H3Z1", "Mr. Khan", "po@motocore.in", "+91 98200 33333", "Engine", "Advance", 3.8, "approved"],
    ["V-004", "BrightWay Electricals", "06UVWXY3456J4Z9", "Mr. Singh", "hello@brightway.in", "+91 98200 44444", "Electrical", "Net 30", 4.0, "pending"],
    ["V-005", "GripX Tyres", "33ABCGX7788K5Z2", "Ms. Iyer", "orders@gripx.in", "+91 98200 55555", "Wheels", "Net 60", 4.3, "approved"],
  ];
  for (const v of vendors)
    await sql`INSERT INTO vendors (code,name,gst,contact,email,phone,category,payment_terms,rating,status)
      VALUES (${v[0]},${v[1]},${v[2]},${v[3]},${v[4]},${v[5]},${v[6]},${v[7]},${v[8]},${v[9]})`;

  const customers = [
    ["C-001", "Speed Motors", "29AAACS1111A1Z1", "buy@speedmotors.in", "+91 90000 11111", "MG Road, Bengaluru", "MG Road, Bengaluru", 200000, "Net 30"],
    ["C-002", "Highway Auto Spares", "27AAACH2222B2Z2", "orders@highwayauto.in", "+91 90000 22222", "FC Road, Pune", "FC Road, Pune", 150000, "Net 15"],
    ["C-003", "City Bike Garage", "24AAACC3333C3Z3", "city@bikegarage.in", "+91 90000 33333", "SG Highway, Ahmedabad", "SG Highway, Ahmedabad", 80000, "Advance"],
    ["C-004", "Rider's Hub", "06AAACR4444D4Z4", "hub@riders.in", "+91 90000 44444", "Mall Road, Delhi", "Mall Road, Delhi", 120000, "Net 30"],
  ];
  const custIds = [];
  for (const c of customers) {
    const [row] = await sql`INSERT INTO customers (code,name,gst,email,phone,billing,shipping,credit_limit,payment_terms)
      VALUES (${c[0]},${c[1]},${c[2]},${c[3]},${c[4]},${c[5]},${c[6]},${c[7]},${c[8]}) RETURNING id`;
    custIds.push(row.id);
  }

  const so = async (no, cust, status, date, inv) =>
    (await sql`INSERT INTO sales_orders (so_no,customer_id,status,order_date,invoice_no) VALUES (${no},${cust},${status},${date},${inv}) RETURNING id`)[0].id;
  const soLine = (soId, skuId, qty, price) =>
    sql`INSERT INTO so_lines (so_id,sku_id,qty,price) VALUES (${soId},${skuId},${qty},${price})`;

  const so1 = await so("SO-1001", custIds[0], "confirmed", "2026-06-17", "INV-2001");
  await soLine(so1, skuIds[0], 10, 450); await soLine(so1, skuIds[2], 5, 980); await soLine(so1, skuIds[7], 20, 180);
  const so2 = await so("SO-1002", custIds[1], "confirmed", "2026-06-18", "INV-2002");
  await soLine(so2, skuIds[5], 8, 320); await soLine(so2, skuIds[6], 8, 320);
  const so3 = await so("SO-1003", custIds[2], "draft", "2026-06-19", null);
  await soLine(so3, skuIds[11], 4, 1850);

  const po = async (no, vend, status, date) =>
    (await sql`INSERT INTO purchase_orders (po_no,vendor_id,status,order_date) VALUES (${no},${vend},${status},${date}) RETURNING id`)[0].id;
  const poLine = (poId, skuId, qty, price) =>
    sql`INSERT INTO po_lines (po_id,sku_id,qty,price) VALUES (${poId},${skuId},${qty},${price})`;
  const po1 = await po("PO-5001", 1, "approved", "2026-06-15");
  await poLine(po1, skuIds[0], 50, 300); await poLine(po1, skuIds[1], 20, 850);
  const po2 = await po("PO-5002", 3, "sent", "2026-06-16");
  await poLine(po2, skuIds[4], 30, 1100);

  await sql`INSERT INTO notifications (role,type,message) VALUES ('purchase','po_approval','PO-5002 is awaiting your approval')`;
  await sql`INSERT INTO notifications (role,type,message) VALUES ('warehouse','low_stock','Clutch Plate Kit is below minimum stock (3 left)')`;
  await sql`INSERT INTO notifications (role,type,message) VALUES ('dispatch','so_confirmed','SO-1001 confirmed — ready for picking')`;
});

console.log("Seed complete.");
await sql.end();
