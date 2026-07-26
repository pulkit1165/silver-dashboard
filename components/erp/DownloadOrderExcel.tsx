"use client";

import * as XLSX from "xlsx";

export interface OrderExcelLine {
  sku_code: string; sku_name: string; gst_rate: number | null; mrp: number | null;
  price: number; discount_pct: number | null; rate_type: string | null;
  std_pack: number | null; bal_qty: number | null; qty: number; foc_qty: number | null;
  picked_qty: number; packed_qty: number; dispatched_qty: number; cancelled_qty: number | null;
}
export interface OrderExcel {
  so_no: string; customer_name: string; order_date: string; status: string;
  bill_type: string; disc_pct: number; remarks: string; lines: OrderExcelLine[];
}

// Builds and downloads a real .xlsx of the sales order (replaces the broken print).
export default function DownloadOrderExcel({ order }: { order: OrderExcel }) {
  function download() {
    const header = [
      ["Sales Order", order.so_no],
      ["Customer", order.customer_name],
      ["Order date", order.order_date],
      ["Status", order.status],
      ["Bill type", order.bill_type || "—"],
      ["Discount %", order.disc_pct ? `${order.disc_pct.toFixed(2)}%` : "—"],
      ["Remarks", order.remarks || "—"],
      [],
    ];
    const cols = [
      "SKU Code", "Item", "GST %", "MRP", "Net Rate", "Disc %", "Rate Type",
      "Std Pack", "Bal Qty", "Ordered", "FOC Qty", "Picked", "Packed", "Dispatched",
      "Cancelled", "Line Total",
    ];
    const body = order.lines.map((l) => [
      l.sku_code, l.sku_name, l.gst_rate ?? "", l.mrp ?? "", l.price,
      l.discount_pct ?? "", l.rate_type ?? "", l.std_pack ?? "", l.bal_qty ?? "",
      l.qty, l.foc_qty ?? 0, l.picked_qty, l.packed_qty, l.dispatched_qty,
      l.cancelled_qty ?? 0, Number((l.qty * l.price).toFixed(2)),
    ]);
    const total = order.lines.reduce((a, l) => a + l.qty * l.price, 0);
    const aoa = [...header, cols, ...body, [], ["", "TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", "", Number(total.toFixed(2))]];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 7 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 9 },
      { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 11 }, { wch: 10 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Order");
    XLSX.writeFile(wb, `${order.so_no.replace(/[^\w.-]+/g, "_")}.xlsx`);
  }

  return (
    <button
      onClick={download}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--surface-2)]"
      title="Download this order as an Excel file"
    >
      ⬇ Download Excel
    </button>
  );
}
