import { NextResponse, type NextRequest } from "next/server";
import { SYNC_TABLES, syncTable, logSync, finishLog } from "@/lib/erp/oracle-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — Vercel Pro allows this for cron routes

// Auth: Vercel cron sends  Authorization: Bearer <CRON_SECRET>
// Manual trigger: same header, or call with ?secret=<CRON_SECRET>
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const query  = req.nextUrl.searchParams.get("secret") ?? "";
  return header === `Bearer ${secret}` || query === secret;
}

// GET  — called by Vercel cron at 6:30 PM IST daily (syncs today + yesterday)
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today    = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const fromDate = yesterday.toISOString().slice(0, 10);
  const toDate   = today.toISOString().slice(0, 10);

  return runSync("daily", null, fromDate, toDate);
}

// POST — manual trigger  { table?, fromDate?, toDate? }
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    table?: string; fromDate?: string; toDate?: string; mode?: string;
  };

  const table    = body.table    ?? null;
  const fromDate = body.fromDate ?? null;
  const toDate   = body.toDate   ?? null;
  const mode     = body.mode     ?? "manual";

  return runSync(mode, table, fromDate, toDate);
}

async function runSync(
  mode: string,
  tableFilter: string | null,
  fromDate: string | null,
  toDate: string | null
) {
  const started = Date.now();
  const logId = await logSync(mode, tableFilter, fromDate, toDate);

  const tables = tableFilter
    ? SYNC_TABLES.filter(t => t.name === tableFilter)
    : SYNC_TABLES;

  const results = [];
  let totalUpserted = 0;

  for (const def of tables) {
    const r = await syncTable(def, {
      fromDate: fromDate ?? undefined,
      toDate:   toDate   ?? undefined,
    });
    results.push(r);
    totalUpserted += r.upserted;

    // 2 s pause between tables — Oracle stays comfortable
    if (tables.indexOf(def) < tables.length - 1) {
      await new Promise(res => setTimeout(res, 2000));
    }
  }

  const errors = results.filter(r => r.error);
  const durationMs = Date.now() - started;

  await finishLog(
    logId, totalUpserted, durationMs,
    errors.length ? errors.map(e => `${e.table}: ${e.error}`).join("; ") : undefined
  );

  return NextResponse.json({
    ok: errors.length === 0,
    mode, fromDate, toDate,
    totalUpserted,
    durationMs,
    results,
  });
}
