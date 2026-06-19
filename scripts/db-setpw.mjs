// Sets a password for any user that doesn't have one yet (idempotent).
// Default password is "silverup123" unless SEED_PASSWORD is set.
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const pw = process.env.SEED_PASSWORD || "silverup123";
const hash = bcrypt.hashSync(pw, 10);
const sql = postgres(url, { prepare: false });

const rows = await sql`UPDATE users SET password_hash=${hash} WHERE password_hash IS NULL RETURNING email`;
console.log(`Set password for ${rows.length} user(s). Default password: ${pw}`);
rows.forEach((r) => console.log("  ", r.email));
await sql.end();
