// Roles, module access, and the ERP navigation map (single source of truth).
export type Role =
  | "admin" | "sales" | "purchase" | "inventory" | "warehouse"
  | "dispatch" | "accounts" | "vendor" | "retailer" | "viewer";

export const ROLES: Role[] = [
  "admin", "sales", "purchase", "inventory", "warehouse", "dispatch", "accounts", "vendor", "retailer", "viewer",
];

// Per-user module access (Shopify-style: pick which sections a specific person
// can use, not just a fixed role bucket). One key per NAV folder below, plus
// "overview" for the handful of role-gated top-level pages (Ask AI, Analytics).
export type ModuleKey =
  | "overview" | "scanning" | "packing" | "inventory" | "masterFiles" | "sales"
  | "purchase" | "financeReports" | "gstCompliance" | "administration";

export const MODULES: { key: ModuleKey; label: string }[] = [
  { key: "overview", label: "Overview (Home, Dashboard, Activity, Checklist, Rule Book, Ask AI, Analytics)" },
  { key: "scanning", label: "Scanning" },
  { key: "packing", label: "Packing" },
  { key: "inventory", label: "Inventory" },
  { key: "masterFiles", label: "Master Files" },
  { key: "sales", label: "Sales" },
  { key: "purchase", label: "Purchase" },
  { key: "financeReports", label: "Finance & Reports" },
  { key: "gstCompliance", label: "GST Compliance" },
  { key: "administration", label: "Administration" },
];

export type ModuleAccess = Partial<Record<ModuleKey, boolean>>;

// The minimal shape canSee/canWrite need — a structural subset of session.ts's
// CurrentUser, kept local (rather than imported) to avoid a circular import
// (session.ts already imports Role from here).
export interface AccessUser {
  role: Role;
  moduleAccess?: ModuleAccess | null;
}

// A leaf is a single page (a link). A folder is a module that opens a flyout
// submenu listing its pages/"reports" (e.g. Packing → Slip / Saved / Live).
export type NavItem = { href: string; label: string; icon: string; roles: Role[] | "all" };
export type NavFolder = { key: ModuleKey; label: string; icon: string; children: NavItem[] };
export type NavEntry = NavItem | NavFolder;
export type NavGroup = { group: string; items: NavEntry[] };

const ALL: "all" = "all";

export const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { href: "/erp/assistant", label: "Ask AI", icon: "✦", roles: ["admin", "accounts", "sales", "purchase", "inventory"] },
      { href: "/", label: "Home", icon: "⌂", roles: ALL },
      { href: "/erp", label: "ERP Dashboard", icon: "▥", roles: ALL },
      { href: "/erp/activity", label: "Activity Feed", icon: "⚡", roles: ALL },
      { href: "/erp/analytics", label: "Analytics", icon: "📊", roles: ["admin", "accounts", "sales", "purchase", "inventory"] },
      { href: "/erp/checklist", label: "Process Checklist", icon: "✔", roles: ALL },
      { href: "/erp/rulebook", label: "Rule Book", icon: "✅", roles: ALL },
    ],
  },
  {
    group: "Workspaces",
    items: [
      {
        key: "scanning", label: "Scanning", icon: "▣",
        children: [
          { href: "/erp/scan", label: "QR Scanner", icon: "▣", roles: ["admin", "warehouse", "dispatch", "inventory"] },
          { href: "/erp/qr", label: "QR Codes", icon: "❒", roles: ["admin", "warehouse", "inventory"] },
          { href: "/erp/scan/history", label: "Scan History", icon: "≣", roles: ["admin", "warehouse", "dispatch", "inventory", "accounts"] },
        ],
      },
      {
        key: "packing", label: "Packing", icon: "▤",
        children: [
          { href: "/erp/packing-slip", label: "Pack & Dispatch", icon: "▤", roles: ["admin", "warehouse", "dispatch"] },
          { href: "/erp/packing-slip/saved", label: "Saved Slips", icon: "🗂", roles: ["admin", "warehouse", "dispatch", "accounts", "sales"] },
          { href: "/erp/packing-slip/live", label: "Live View", icon: "📺", roles: ["admin", "warehouse", "dispatch"] },
        ],
      },
      {
        key: "inventory", label: "Inventory", icon: "▦",
        children: [
          { href: "/erp/skus", label: "SKU Master", icon: "▦", roles: ["admin", "inventory", "warehouse", "sales", "purchase"] },
          { href: "/erp/catalog", label: "Product Catalogue", icon: "📖", roles: ["admin", "inventory", "warehouse", "sales", "purchase", "accounts"] },
          { href: "/erp/catalog/custom-list", label: "Custom List → PDF", icon: "📄", roles: ["admin", "inventory", "warehouse", "sales", "purchase", "accounts"] },
          { href: "/erp/skus/import", label: "Import SKUs", icon: "⬆", roles: ["admin", "inventory"] },
          { href: "/erp/skus/import-labels", label: "Backfill Barcode Info", icon: "⬆", roles: ["admin", "inventory"] },
          { href: "/erp/stickers", label: "Print Stickers", icon: "🏷", roles: ["admin", "inventory", "warehouse"] },
          { href: "/erp/stickers/design", label: "Sticker Designer", icon: "🎨", roles: ["admin", "inventory"] },
          { href: "/erp/labels/printers", label: "Printers", icon: "🖨", roles: ["admin", "inventory", "warehouse"] },
          { href: "/erp/print-queue", label: "Print Queue", icon: "🖨️", roles: ["admin", "inventory", "warehouse"] },
          { href: "/erp/print-bridge", label: "Print Bridge (devices)", icon: "🌐", roles: ["admin", "inventory", "warehouse"] },
          { href: "/erp/inventory", label: "Stock", icon: "≡", roles: ["admin", "inventory", "warehouse", "sales"] },
          { href: "/erp/warehouses", label: "Warehouses", icon: "⊞", roles: ["admin", "inventory", "warehouse"] },
        ],
      },
      {
        key: "masterFiles", label: "Master Files", icon: "🗎",
        children: [
          { href: "/erp/customers", label: "Customer Master", icon: "☻", roles: ["admin", "sales", "accounts"] },
          { href: "/erp/vendors", label: "Vendor Master", icon: "⚒", roles: ["admin", "purchase", "accounts", "vendor"] },
          { href: "/erp/skus", label: "Item Master (SKU + MRP)", icon: "▦", roles: ["admin", "inventory", "warehouse", "sales", "purchase", "accounts"] },
          { href: "/erp/cost-price", label: "Cost Price Sheet", icon: "₹", roles: ["admin", "sales", "purchase", "accounts", "inventory", "viewer"] },
          { href: "/erp/masters/weight", label: "Product Weight", icon: "⚖", roles: ["admin", "sales", "purchase", "accounts", "inventory", "viewer"] },
          { href: "/erp/masters/label", label: "Barcode / Label Master", icon: "🏷️", roles: ["admin", "inventory", "warehouse", "sales"] },
          { href: "/erp/masters/discount", label: "Discount Master", icon: "₹", roles: ["admin", "sales", "accounts"] },
          { href: "/erp/masters/import", label: "Upload / Overwrite (Excel)", icon: "⬆", roles: ["admin", "sales", "accounts", "purchase", "inventory"] },
        ],
      },
      {
        key: "sales", label: "Sales", icon: "↗",
        children: [
          { href: "/erp/sales", label: "Sales Orders", icon: "↗", roles: ["admin", "sales", "dispatch", "accounts"] },
          { href: "/erp/sales/silver-retailer-network", label: "Silver Retailer Network", icon: "🤝", roles: ["admin", "sales", "accounts", "retailer"] },
          { href: "/erp/sales/decode", label: "Upload / Decode Order", icon: "⬆", roles: ["admin", "sales"] },
          { href: "/erp/sales/decoded", label: "Decode Orders", icon: "📥", roles: ["admin", "sales"] },
          { href: "/erp/deliveries", label: "Delivery Orders", icon: "🚚", roles: ["admin", "sales", "dispatch", "warehouse", "accounts"] },
          { href: "/erp/invoices", label: "Invoices", icon: "🧾", roles: ["admin", "sales", "accounts", "dispatch"] },
          { href: "/erp/customers", label: "Customers", icon: "☻", roles: ["admin", "sales", "accounts"] },
        ],
      },
      {
        key: "purchase", label: "Purchase", icon: "↙",
        children: [
          { href: "/erp/purchase/quotations", label: "Quotations", icon: "📝", roles: ["admin", "purchase", "accounts"] },
          { href: "/erp/purchase/quotations?status=pending", label: "Approvals", icon: "✔", roles: ["admin"] },
          { href: "/erp/purchase/indents", label: "Indents", icon: "📄", roles: ["admin", "purchase", "accounts"] },
          { href: "/erp/purchase", label: "Purchase Orders", icon: "↙", roles: ["admin", "purchase", "accounts"] },
          { href: "/erp/purchase/vendor-compare", label: "Vendor Comparison", icon: "⚖", roles: ["admin", "purchase", "accounts"] },
          { href: "/erp/grn", label: "Goods Receipts", icon: "📥", roles: ["admin", "purchase", "warehouse", "accounts"] },
          { href: "/erp/vendor-bills", label: "Vendor Bills", icon: "🧾", roles: ["admin", "purchase", "accounts"] },
          { href: "/erp/vendors", label: "Vendors", icon: "⚒", roles: ["admin", "purchase", "accounts", "vendor"] },
        ],
      },
      {
        key: "financeReports", label: "Finance & Reports", icon: "₹",
        children: [
          { href: "/erp/finance", label: "Finance", icon: "₹", roles: ["admin", "accounts"] },
          { href: "/erp/reports", label: "Reports", icon: "▤", roles: ["admin", "sales", "purchase", "accounts", "inventory"] },
        ],
      },
      {
        key: "gstCompliance", label: "GST Compliance", icon: "🧮",
        children: [
          { href: "/erp/gst/gstr1", label: "GSTR-1 Export", icon: "📤", roles: ["admin", "accounts"] },
          { href: "/erp/gst/eway-bills", label: "e-Way Bills", icon: "🚛", roles: ["admin", "accounts", "sales", "dispatch"] },
          { href: "/erp/gst/gstr2b", label: "GSTR-2B Reconcile", icon: "🔗", roles: ["admin", "accounts"] },
        ],
      },
      {
        key: "administration", label: "Administration", icon: "⚿",
        children: [
          { href: "/erp/users", label: "Users & Roles", icon: "⚿", roles: ["admin"] },
          { href: "/erp/masters/company", label: "Company Settings", icon: "🏢", roles: ["admin"] },
          { href: "/erp/device-locations", label: "Device Locations", icon: "📍", roles: ["admin"] },
          { href: "/connection", label: "Oracle Link", icon: "⚙", roles: ["admin", "accounts"] },
        ],
      },
    ],
  },
];

export function isFolder(e: NavEntry): e is NavFolder {
  return (e as NavFolder).children !== undefined;
}

// Every href's owning module, derived once from NAV. The whole ungrouped
// "Overview" group (including its "all"-role baseline pages: Home, ERP
// Dashboard, Activity Feed, Checklist, Rule Book) maps to "overview" too —
// for a module-restricted user those are NOT an unconditional bypass; a user
// granted zero modules sees zero pages, matching Shopify's "nothing outside
// what you checked" behaviour. A few hrefs (e.g. /erp/customers, /erp/skus)
// are deliberately listed as a child of TWO folders for navigational
// convenience — this map can only hold one owner per href (last one
// registered wins), so it's a fine best-effort for canSee's non-folder uses
// (the Overview items, the informational access matrix), but NOT precise
// enough to gate actual sidebar rendering — that's what visibleChildren is
// for below, which uses the folder's own key instead and so never has this
// ambiguity.
const HREF_TO_MODULE = new Map<string, ModuleKey>();
for (const group of NAV) {
  for (const entry of group.items) {
    if (isFolder(entry)) for (const child of entry.children) HREF_TO_MODULE.set(child.href, entry.key);
    else HREF_TO_MODULE.set(entry.href, "overview");
  }
}

// External/restricted roles (the retailer firm) see ONLY pages that name them
// explicitly — never the "all" pages (dashboard, activity, etc.). This is a
// role-level policy (not per-user module access) — retailer accounts aren't
// given custom module_access in the admin UI.
const RESTRICTED: Role[] = ["retailer"];

export function canSee(user: AccessUser, item: NavItem): boolean {
  if (user.role === "admin") return true;
  if (RESTRICTED.includes(user.role)) return item.roles !== "all" && item.roles.includes(user.role);
  if (user.moduleAccess) {
    // Per-user access is strict: "all" is not a bypass here — a user granted
    // zero modules (including "overview") sees zero pages, full stop.
    const key = HREF_TO_MODULE.get(item.href);
    return key ? !!user.moduleAccess[key] : false;
  }
  if (item.roles === "all") return true; // legacy/unmigrated user — baseline pages stay universal, as before
  return item.roles.includes(user.role);
}

// Children of a folder this user may see (empty → hide the whole folder).
// Deliberately does NOT delegate to canSee's href lookup — several hrefs are
// shared between two folders (e.g. /erp/customers under both Master Files and
// Sales), and resolving by folder.key here (rather than by href) is what
// keeps "granted Sales but not Master Files" from also exposing the
// Master-Files-flavoured link to that same page.
export function visibleChildren(user: AccessUser, folder: NavFolder): NavItem[] {
  if (user.role === "admin") return folder.children;
  if (RESTRICTED.includes(user.role)) return folder.children.filter((c) => c.roles !== "all" && c.roles.includes(user.role));
  if (user.moduleAccess) return user.moduleAccess[folder.key] ? folder.children : [];
  return folder.children.filter((c) => c.roles === "all" || c.roles.includes(user.role)); // legacy/unmigrated user
}

// Every leaf page in the nav, folders flattened out — used by the access matrix.
export function leafNavItems(): NavItem[] {
  return NAV.flatMap((g) => g.items.flatMap((e) => (isFolder(e) ? e.children : [e])));
}

// Write/approve capability per module (used to gate mutating actions).
const WRITERS: Record<string, Role[]> = {
  scan: ["admin", "warehouse", "dispatch", "inventory"],
  skus: ["admin", "inventory"],
  inventory: ["admin", "inventory", "warehouse"],
  sales: ["admin", "sales"],
  dispatch: ["admin", "dispatch", "warehouse"],
  purchase: ["admin", "purchase"],
  vendors: ["admin", "purchase"],
  customers: ["admin", "sales", "accounts"],
  invoices: ["admin", "accounts", "sales"],
  users: ["admin"],
  labels: ["admin", "inventory", "warehouse"],
  rates: ["admin", "sales", "accounts"],
  company_settings: ["admin"],
  gst: ["admin", "accounts"],
  eway_bills: ["admin", "accounts", "sales", "dispatch"],
  device_locations: ["admin"],
};

// Which module folder each WRITERS key belongs to, for the per-user check.
const WRITER_MODULE: Record<keyof typeof WRITERS, ModuleKey> = {
  scan: "scanning",
  skus: "inventory",
  inventory: "inventory",
  sales: "sales",
  dispatch: "packing",
  purchase: "purchase",
  vendors: "purchase",
  customers: "sales",
  invoices: "sales",
  users: "administration",
  labels: "inventory",
  rates: "masterFiles",
  company_settings: "administration",
  gst: "gstCompliance",
  eway_bills: "gstCompliance",
  device_locations: "administration",
};

export function canWrite(user: AccessUser, module: keyof typeof WRITERS): boolean {
  if (user.role === "admin") return true;
  if (user.moduleAccess) {
    const key = WRITER_MODULE[module];
    return key ? !!user.moduleAccess[key] : (WRITERS[module]?.includes(user.role) ?? false);
  }
  return WRITERS[module]?.includes(user.role) ?? false; // legacy/unmigrated user — unchanged
}

// Which roles currently touch each module at all (nav visibility OR write
// capability) — the single source of truth both for "unmigrated user" fallback
// (see canSee/canWrite above, which don't use this directly but derive the
// same facts from NAV/WRITERS) and for prefilling the admin UI's checkbox grid
// when a template role is picked for a new/edited user.
const MODULE_ROLES = new Map<ModuleKey, Set<Role>>(MODULES.map((m) => [m.key, new Set<Role>()]));
for (const [href, key] of HREF_TO_MODULE) {
  const item = leafNavItems().find((i) => i.href === href);
  if (!item) continue;
  const set = MODULE_ROLES.get(key)!;
  if (item.roles === "all") for (const r of ROLES) set.add(r);
  else for (const r of item.roles) set.add(r);
}
for (const w of Object.keys(WRITERS) as (keyof typeof WRITERS)[]) {
  const set = MODULE_ROLES.get(WRITER_MODULE[w])!;
  for (const r of WRITERS[w]) set.add(r);
}

export function roleModuleDefaults(role: Role): ModuleAccess {
  const out: ModuleAccess = {};
  for (const m of MODULES) out[m.key] = role === "admin" || (MODULE_ROLES.get(m.key)?.has(role) ?? false);
  return out;
}

export function roleLabel(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
