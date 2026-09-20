import { redirect } from "next/navigation";

// Quotations no longer have their own list — they live inside the indent
// that spawned them. See app/erp/purchase/indents/page.tsx.
export default function QuotationsRedirect() {
  redirect("/erp/purchase/indents");
}
