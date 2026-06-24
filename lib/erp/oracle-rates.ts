import "server-only";
import { runQuery } from "@/lib/oracle";

// Historical rate reference pulled from the live (read-only) Oracle link.
// Used only to suggest rates when building a new sales order in Postgres —
// never written back to Oracle.

export interface RateHistoryRow {
  trdate: string;
  partyName: string;
  itemCode: string;
  itemDescription: string;
  rate: number;
  quantity: number;
}

// No bind-parameter support over the remote connector path, so search terms
// are inlined — escape quotes to stay safe. assertSelectOnly() still rejects
// anything that isn't a single SELECT.
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function toRows(rows: Array<Record<string, unknown>>): RateHistoryRow[] {
  return rows.map((r) => ({
    trdate: String(r.TRDATE ?? ""),
    partyName: String(r.PARTY_NAME ?? ""),
    itemCode: String(r.ITEMCODE ?? ""),
    itemDescription: String(r.ITEMDESCRIPTION ?? ""),
    rate: Number(r.RATE) || 0,
    quantity: Number(r.QUANTITY) || 0,
  }));
}

/** Recent rates for an item across all customers — the "item-wise net rate" reference. */
export async function lookupItemRates(itemQuery: string, limit = 15): Promise<RateHistoryRow[]> {
  const q = esc(itemQuery.trim().toUpperCase());
  if (!q) return [];
  const sql = `select * from (
    select d.trdate, m.acntdesc as party_name, d.itemcode, d.itemdescription, d.rate, d.quantity
      from VW_SALE_GST_D d
      join VW_SALE_GST_M m on m.trmid = d.trmid
     where upper(d.itemdescription) like '%${q}%'
     order by d.trdate desc
  ) where rownum <= ${limit}`;
  const res = await runQuery(sql);
  return toRows(res.rows);
}

/** Rate history for a specific party + item — the "party-wise net rate" reference. */
export async function lookupPartyItemRates(
  itemQuery: string,
  partyQuery: string,
  limit = 10,
): Promise<RateHistoryRow[]> {
  const qi = esc(itemQuery.trim().toUpperCase());
  const qp = esc(partyQuery.trim().toUpperCase());
  if (!qi || !qp) return [];
  const sql = `select * from (
    select d.trdate, m.acntdesc as party_name, d.itemcode, d.itemdescription, d.rate, d.quantity
      from VW_SALE_GST_D d
      join VW_SALE_GST_M m on m.trmid = d.trmid
     where upper(d.itemdescription) like '%${qi}%'
       and upper(m.acntdesc) like '%${qp}%'
     order by d.trdate desc
  ) where rownum <= ${limit}`;
  const res = await runQuery(sql);
  return toRows(res.rows);
}
