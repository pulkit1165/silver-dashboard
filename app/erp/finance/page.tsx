import PageHeader from "@/components/PageHeader";
import { financeSummary, getSalesOrders, getPurchaseOrders } from "@/lib/erp/queries";

export const dynamic = "force-dynamic";
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default async function FinancePage() {
  const [f, so, po] = await Promise.all([financeSummary(), getSalesOrders(), getPurchaseOrders()]);
  return (
    <>
      <PageHeader title="Finance & Accounts" subtitle="Receivables, payables, revenue and stock valuation (foundation for full accounting)." />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="kpi"><div className="lab">Receivables</div><div className="num">{inr(f.receivables)}</div><div className="sub">open sales value</div></div>
        <div className="kpi"><div className="lab">Revenue (dispatched)</div><div className="num">{inr(f.dispatched)}</div></div>
        <div className="kpi"><div className="lab">Payables</div><div className="num">{inr(f.payables)}</div><div className="sub">open purchase value</div></div>
        <div className="kpi"><div className="lab">Stock value</div><div className="num">{inr(f.stock_value)}</div></div>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="panel">
          <div className="panel-hd">Sales invoices / orders</div>
          <table className="rtable">
            <thead><tr><th>Order</th><th>Customer</th><th>Invoice</th><th>Status</th></tr></thead>
            <tbody>{so.map((o) => <tr key={o.id}><td>{o.so_no}</td><td>{o.customer_name}</td><td>{o.invoice_no ?? "—"}</td><td><span className="tag n">{o.status}</span></td></tr>)}</tbody>
          </table>
        </section>
        <section className="panel">
          <div className="panel-hd">Purchase invoices / orders</div>
          <table className="rtable">
            <thead><tr><th>PO</th><th>Vendor</th><th>Status</th></tr></thead>
            <tbody>{po.map((p) => <tr key={p.id}><td>{p.po_no}</td><td>{p.vendor_name}</td><td><span className="tag n">{p.status}</span></td></tr>)}</tbody>
          </table>
        </section>
      </div>
    </>
  );
}
