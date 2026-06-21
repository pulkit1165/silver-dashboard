import "server-only";
import { getSql } from "./db";

export interface PackingSlipRow {
  id: number; slip_no: string; so_no: string | null; party: string | null;
  data: unknown; updated_by: string | null; updated_at: string;
}

export async function listPackingSlips() {
  return (await getSql()`
    SELECT id, slip_no, so_no, party, updated_by, updated_at
    FROM packing_slips ORDER BY updated_at DESC LIMIT 100`) as unknown as Omit<PackingSlipRow, "data">[];
}

export async function getPackingSlip(idOrNo: string | number): Promise<PackingSlipRow | undefined> {
  const sql = getSql();
  const byId = typeof idOrNo === "number" || /^\d+$/.test(String(idOrNo));
  const [row] = byId
    ? await sql`SELECT * FROM packing_slips WHERE id=${Number(idOrNo)}`
    : await sql`SELECT * FROM packing_slips WHERE slip_no=${String(idOrNo)}`;
  return row as PackingSlipRow | undefined;
}

export async function upsertPackingSlip(input: {
  slipNo: string; soNo?: string | null; party?: string | null; data: unknown; updatedBy?: string | null;
}) {
  const sql = getSql();
  const [row] = await sql`
    INSERT INTO packing_slips (slip_no, so_no, party, data, updated_by, updated_at)
    VALUES (${input.slipNo}, ${input.soNo ?? null}, ${input.party ?? null}, ${sql.json(input.data as never)},
            ${input.updatedBy ?? null}, to_char(clock_timestamp(),'YYYY-MM-DD HH24:MI:SS.MS'))
    ON CONFLICT (slip_no) DO UPDATE SET
      so_no=EXCLUDED.so_no, party=EXCLUDED.party, data=EXCLUDED.data,
      updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at
    RETURNING id, updated_at`;
  return row as { id: number; updated_at: string };
}

/** Cheap, append-only change fingerprint used by the live poller. */
export async function liveFingerprint(): Promise<string> {
  const [r] = await getSql()`
    SELECT
      (SELECT COALESCE(MAX(id),0) FROM scan_events) a,
      (SELECT COALESCE(MAX(id),0) FROM stock_moves) b,
      (SELECT COALESCE(MAX(id),0) FROM sales_orders) c,
      (SELECT COALESCE(MAX(id),0) FROM purchase_orders) d,
      (SELECT COALESCE(MAX(id),0) FROM package_lines) e,
      (SELECT COALESCE(MAX(id),0) FROM skus) f,
      (SELECT COALESCE(MAX(id),0) FROM qr_codes) g,
      (SELECT COALESCE(MAX(updated_at),'') FROM packing_slips) h`;
  const x = r as Record<string, string | number>;
  return [x.a, x.b, x.c, x.d, x.e, x.f, x.g, x.h].join("-");
}
