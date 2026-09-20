import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import SalesDecoder from "@/components/erp/SalesDecoder";
import { getCustomers, getSalesmen } from "@/lib/erp/queries";
import { aiAvailable } from "@/lib/erp/sales-decode";

export const dynamic = "force-dynamic";

// Customers have no city column — derive a short city/place from the billing address
// (its last meaningful comma segment; skip a 2-3 letter state code + any PIN token).
function cityOf(billing?: string | null): string {
  const parts = String(billing ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return "";
  let last = parts[parts.length - 1];
  if (/^[A-Za-z]{2,3}$/.test(last) && parts.length >= 2) last = parts[parts.length - 2];
  return last.replace(/\bPIN\s*\d+\b/i, "").replace(/\b\d{6}\b/, "").trim();
}

export default async function SalesDecodePage() {
  const [customers, salesmen] = await Promise.all([getCustomers(), getSalesmen()]);
  return (
    <>
      <PageHeader
        title="Upload / Decode Order"
        subtitle="Photo of a handwritten slip, type the order in text, or upload an Excel/CSV — AI reads it, you verify, then punch as a real sales order."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Link href="/erp/sales/decode/manual" className="panel flex items-center gap-3 p-4 hover:bg-[var(--surface-2)]">
          <span className="text-2xl">✍️</span>
          <span>
            <span className="block font-bold">Write order manually</span>
            <span className="block text-xs text-[var(--muted)]">Pick party &amp; items, review, submit for punching.</span>
          </span>
        </Link>
        <Link href="/erp/sales/decoded" className="panel flex items-center gap-3 p-4 hover:bg-[var(--surface-2)]">
          <span className="text-2xl">📥</span>
          <span>
            <span className="block font-bold">Decode Orders queue</span>
            <span className="block text-xs text-[var(--muted)]">Submitted orders waiting to be promoted &amp; punched.</span>
          </span>
        </Link>
      </div>
      <div className="panel-hd mb-3 rounded-lg">📷 Or decode from a photo / text / Excel (AI)</div>
      <SalesDecoder
        customers={customers.map((c) => ({ id: c.id, code: c.code, name: c.name, city: cityOf((c as { billing?: string }).billing) }))}
        salesmen={salesmen}
        aiReady={aiAvailable()}
      />
    </>
  );
}
