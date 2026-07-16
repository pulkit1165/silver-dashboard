import "server-only";
import { getSql } from "./db";

// The read-only analytics assistant ("Ask AI"): Claude writes PostgreSQL SELECTs
// against the live ERP, we execute them safely (read-only txn, capped), and Claude
// explains the result. It can NEVER write — see runReadOnlySql.

export const ASSISTANT_MODEL = "claude-opus-4-8";
const MAX_ROWS = 500;

// ---- live schema introspection (cached per server process) --------------------
let schemaCache: string | null = null;
const shortType = (t: string) =>
  t.includes("double") || t.includes("numeric") ? "num"
  : t === "integer" || t === "bigint" ? "int"
  : t === "boolean" ? "bool"
  : t.includes("json") ? "json"
  : t.includes("timestamp") ? "ts"
  : "text";

export async function getSchemaContext(): Promise<string> {
  if (schemaCache) return schemaCache;
  const rows = (await getSql()`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`) as unknown as Array<{
    table_name: string; column_name: string; data_type: string;
  }>;
  const byTable = new Map<string, string[]>();
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
    byTable.get(r.table_name)!.push(`${r.column_name} ${shortType(r.data_type)}`);
  }
  schemaCache = [...byTable.entries()].map(([t, cols]) => `${t}(${cols.join(", ")})`).join("\n");
  return schemaCache;
}

// ---- read-only SQL execution --------------------------------------------------
// Belt-and-suspenders: (1) must be a single SELECT/WITH statement, (2) no obvious
// write verbs, (3) executed inside a READ ONLY transaction — Postgres itself
// rejects any write (incl. data-modifying CTEs) with an error.
const WRITE_VERBS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|reindex|cluster|merge|call|lock|listen|notify|set\s+role)\b/i;

export function validateSql(raw: string): { ok: true; sql: string } | { ok: false; error: string } {
  let q = (raw || "").trim();
  if (q.endsWith(";")) q = q.slice(0, -1).trim();
  if (!q) return { ok: false, error: "Empty query." };
  if (q.includes(";")) return { ok: false, error: "Only a single statement is allowed." };
  if (!/^(select|with)\b/i.test(q)) return { ok: false, error: "Only SELECT / WITH queries are allowed." };
  if (WRITE_VERBS.test(q)) return { ok: false, error: "Read-only: data-changing statements are not allowed." };
  return { ok: true, sql: q };
}

export type SqlResult =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }
  | { ok: false; error: string };

export async function runReadOnlySql(raw: string): Promise<SqlResult> {
  const v = validateSql(raw);
  if (!v.ok) return v;
  const sql = getSql();
  try {
    const rows = (await sql.begin(async (tx) => {
      await tx.unsafe("SET TRANSACTION READ ONLY");
      await tx.unsafe("SET LOCAL statement_timeout = 12000");
      return await tx.unsafe(v.sql);
    })) as unknown as Record<string, unknown>[];
    const all = Array.isArray(rows) ? rows : [];
    return { ok: true, rows: all.slice(0, MAX_ROWS), rowCount: all.length, truncated: all.length > MAX_ROWS };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 600) };
  }
}

// ---- prompt + tool ------------------------------------------------------------
export const RUN_SQL_TOOL = {
  name: "run_sql",
  description:
    "Run ONE read-only PostgreSQL query (SELECT, or WITH … SELECT) against the live ERP database and get the rows back as JSON. " +
    "This is the only way to read data — never invent numbers. Only SELECT/WITH is permitted (no INSERT/UPDATE/DELETE/DDL). " +
    "Call it as many times as you need to build up an answer to a complex question. Results are capped at 500 rows, so use " +
    "aggregates (SUM/COUNT/AVG/GROUP BY/ORDER BY/LIMIT) rather than pulling raw rows when answering analytical questions.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sql: { type: "string", description: "A single read-only SELECT/WITH query. No trailing semicolon needed." },
    },
    required: ["sql"],
  },
} as const;

export async function buildSystemPrompt(): Promise<string> {
  const schema = await getSchemaContext();
  return [
    "You are the data analyst for Silver Industries — a bike-parts distributor — answering questions about its ERP over a live PostgreSQL database.",
    "You have one tool, run_sql, which runs read-only SELECT queries. Always answer from real query results; never guess or fabricate numbers. If the data needed to answer isn't tracked anywhere in the schema, say so plainly instead of inventing it.",
    "",
    "How to work:",
    "- Decompose the question, then call run_sql (possibly several times) to get the figures. Prefer aggregates and JOINs over dumping rows.",
    "- After you have the data, give a clear, direct answer led by the headline number/finding. Use a compact markdown table for rankings or lists (e.g. top/bottom customers).",
    "- Money is in Indian Rupees (₹). Dates are stored as TEXT in 'YYYY-MM-DD HH24:MI:SS' or 'YYYY-MM-DD' form — filter with string comparisons (e.g. created_at >= '2026-01-01').",
    "- Be concise but complete. Don't show SQL in your answer (the user can already see the queries you ran). Don't ask permission to query — just do it.",
    "",
    "Domain notes:",
    "- 'client' / 'party' / 'customer' all mean the customers table. Vendors/suppliers are the vendors table.",
    "- *_id columns are foreign keys to the matching table's id: customer_id→customers, vendor_id→vendors, sku_id→skus, so_id→sales_orders, po_id→purchase_orders, invoice_id→invoices, package_id→packages.",
    "- Sales: sales_orders (one per order, has customer_id, total, status, order_date) → so_lines (line items: qty, dispatched_qty, price). Invoices: invoices (customer_id, grand_total, taxable_total, igst/cgst/sgst, invoice_date, transporter/vehicle_no/lr_no/distance_km) → invoice_lines.",
    "- Purchasing: purchase_orders → po_lines. Stock: inventory (qty on hand by sku/warehouse/bin), stock_moves (history), skus (price=MRP, purchase_price, selling_price, reorder_level).",
    "- 'reorders the most' = the customer with the most sales_orders (or repeat orders) — count orders per customer_id.",
    "- Freight/transport is captured on invoices as text (transporter, vehicle_no, lr_no, distance_km); there is no freight-cost amount column, so if asked 'how much we pay for freight' explain that freight charges aren't stored as a money field and offer the closest available (e.g. orders/distance per transporter).",
    "",
    "Database schema (table(column type, …)):",
    schema,
  ].join("\n");
}

// ---- non-streaming runner (shared by web + WhatsApp) --------------------------
// Runs the same tool-use loop as the streaming route, but blocks until the final
// answer and returns plain text. `channel` tweaks the answer format (WhatsApp has
// no markdown tables, so we ask for short plain-text answers there). `role` lets
// the caller note who's asking so the model can tailor tone/scope.
export interface AssistantTurn { role: "user" | "assistant"; content: string }

export interface RunAssistantResult {
  ok: boolean;
  answer: string;
  sqls: string[];
  error?: string;
}

export async function runAssistant(
  question: string,
  opts: { history?: AssistantTurn[]; role?: string; channel?: "web" | "whatsapp"; maxRounds?: number } = {},
): Promise<RunAssistantResult> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  let system = await buildSystemPrompt();
  if (opts.channel === "whatsapp") {
    system +=
      "\n\nChannel = WhatsApp. Reply in short, mobile-friendly plain text (no markdown tables, no headings). " +
      "Lead with the headline number. Use simple hyphen lists at most. Keep it under ~700 characters. " +
      "Reply in the same language the user wrote in (English, Hindi, or Hinglish).";
  }
  if (opts.role) system += `\n\nThe person asking is a Silver Industries "${opts.role}" team member.`;

  const history = (opts.history ?? []).filter((m) => m.role === "user" || m.role === "assistant");
  const messages: Array<{ role: string; content: unknown }> = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question.slice(0, 1000) },
  ];
  const sqls: string[] = [];

  try {
    const maxRounds = opts.maxRounds ?? 8;
    for (let round = 0; round < maxRounds; round++) {
      const params = {
        model: ASSISTANT_MODEL,
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: [RUN_SQL_TOOL],
        messages,
      } as unknown as Parameters<typeof client.messages.create>[0];

      const msg = (await client.messages.create(params)) as unknown as {
        content: Array<Record<string, unknown>>;
        stop_reason: string;
      };
      const toolUses = msg.content.filter((b) => b.type === "tool_use");

      if (msg.stop_reason !== "tool_use" || toolUses.length === 0) {
        const answer = msg.content
          .filter((b) => b.type === "text")
          .map((b) => String(b.text ?? ""))
          .join("\n")
          .trim();
        return { ok: true, answer: answer || "Sorry, I couldn't find an answer to that.", sqls };
      }

      messages.push({ role: "assistant", content: msg.content });
      const results: Array<Record<string, unknown>> = [];
      for (const tu of toolUses) {
        const sqlStr = String((tu.input as { sql?: string })?.sql ?? "");
        sqls.push(sqlStr);
        const res = await runReadOnlySql(sqlStr);
        results.push(
          res.ok
            ? { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ rowCount: res.rowCount, truncated: res.truncated, rows: res.rows }).slice(0, 60000) }
            : { type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Error: ${res.error}` },
        );
      }
      messages.push({ role: "user", content: results });
    }
    return { ok: true, answer: "That needed too many steps to answer — please narrow the question.", sqls };
  } catch (e) {
    return { ok: false, answer: "", sqls, error: String((e as Error)?.message || e).slice(0, 400) };
  }
}
