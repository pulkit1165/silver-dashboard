import type { Config } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

// These tables are created at runtime via `ensure()` (CREATE TABLE IF NOT EXISTS)
// and are deliberately NOT modelled in schema.ts. drizzle-kit push drops any table
// it doesn't know about, so without this filter a routine `db:push` would DELETE all
// of them — wiping saved label alignments, the print queue, agent tokens, and the
// pricing-history masters. Excluding them here makes push physically unable to touch
// them. NEVER remove an entry unless you have first added that table to schema.ts.
const RUNTIME_TABLES_PROTECTED = [
  "activity_log", "agent_tokens", "checklist_tasks",
  "label_layouts", "label_locks", "label_master", "label_names",
  "print_jobs", "print_printers", "sku_aliases",
  "mrp_history", "foc_rates", "item_net_rates",
  "party_disc_history", "party_foc_history", "party_item_net_rates", "party_ogl_history",
];

export default {
  schema: "./lib/erp/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // "!name" = exclude; push/introspect skip these entirely, so they're never dropped.
  tablesFilter: RUNTIME_TABLES_PROTECTED.map((t) => `!${t}`),
} satisfies Config;
