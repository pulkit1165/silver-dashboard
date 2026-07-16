import "server-only";
import * as XLSX from "xlsx";

// Parse an uploaded Sales Order spreadsheet (.xlsx/.xls/.csv) into raw order
// lines. Column headers vary between customers' exports, so we detect them by
// alias rather than by fixed position. Matching to real SKUs happens later
// (lib/erp/sales-decode.ts → decodeSalesRows), reusing the decoder's engine.

export interface SalesFileRow { itemCode: string; raw_text: string; qty: number; rate: number; unit: string }

const FIELD_ALIASES: Record<string, string[]> = {
  code: ["itemcode", "code", "sku", "skucode", "itemno", "itemnumber", "partno", "partnumber", "articleno", "itemcd", "icode", "productcode"],
  desc: ["description", "itemdescription", "itemname", "item", "name", "particulars", "product", "productname", "descriptionofgoods", "goods"],
  qty: ["qty", "quantity", "qnty", "orderqty", "orderedqty", "nos", "pcs", "qtyordered", "billqty"],
  rate: ["rate", "price", "netrate", "unitprice", "rateamount", "sellingprice"],
  party: ["party", "partyname", "customer", "customername", "account", "acnt", "acntdesc", "buyer", "client"],
  unit: ["unit", "uom", "units"],
};
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const numOf = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.\-]/g, "")) || 0;
// Summary/footer rows that carry a qty but aren't order lines.
const TOTAL_WORDS = new Set(["total", "grandtotal", "subtotal", "nettotal", "sum", "gtotal", "totalqty", "amount"]);

function fieldOf(header: string): string | null {
  const h = norm(header);
  if (!h) return null;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((a) => h === a || h.includes(a))) return field;
  }
  return null;
}

export function parseOrderWorkbook(buf: Buffer): { rows: SalesFileRow[]; customerHint: string } {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], customerHint: "" };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });

  // Header row = first of the top rows mapping >=2 known fields, incl qty + (code|desc).
  let headerIdx = -1;
  let colMap: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const map: Record<string, number> = {};
    (grid[i] || []).forEach((cell, idx) => { const f = fieldOf(String(cell)); if (f && map[f] === undefined) map[f] = idx; });
    if (map.qty !== undefined && (map.code !== undefined || map.desc !== undefined)) { headerIdx = i; colMap = map; break; }
  }
  if (headerIdx < 0) return { rows: [], customerHint: "" };

  // Customer hint: a "Party/Customer/M/s: <name>" label somewhere above the header.
  let customerHint = "";
  for (let i = 0; i < headerIdx && !customerHint; i++) {
    const row = grid[i] || [];
    for (let j = 0; j < row.length; j++) {
      const lbl = norm(row[j]);
      if ((lbl.includes("party") || lbl.includes("customer") || lbl.includes("ms") || lbl.includes("buyer")) && row[j + 1]) {
        customerHint = String(row[j + 1]).trim();
        break;
      }
    }
  }

  const rows: SalesFileRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    const get = (f: string) => (colMap[f] !== undefined ? row[colMap[f]] : "");
    const itemCode = String(get("code") ?? "").trim();
    const desc = String(get("desc") ?? "").trim();
    const qty = numOf(get("qty"));
    if (!itemCode && !desc) continue;   // blank / spacer row
    if (TOTAL_WORDS.has(norm(itemCode)) || TOTAL_WORDS.has(norm(desc))) continue; // footer/total row
    if (!(qty > 0)) continue;           // note lines have no qty
    if (!customerHint && colMap.party !== undefined) {
      const p = String(get("party") ?? "").trim();
      if (p) customerHint = p;
    }
    rows.push({ itemCode, raw_text: desc || itemCode, qty, rate: numOf(get("rate")), unit: String(get("unit") ?? "").trim() });
  }
  return { rows, customerHint };
}
