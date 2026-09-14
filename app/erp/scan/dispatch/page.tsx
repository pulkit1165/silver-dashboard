import { redirect } from "next/navigation";

// Pack & Dispatch is now a single page — the Packing Slip screen (scan OR type
// manually, packs for real, creates the Delivery Order + slip). This old
// scan-only screen redirects there so bookmarks/links keep working.
export default function DispatchScanRedirect() {
  redirect("/erp/packing-slip");
}
