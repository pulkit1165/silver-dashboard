// Roles, module access, and the ERP navigation map (single source of truth).
export type Role =
  | "admin" | "sales" | "purchase" | "inventory" | "warehouse"
  | "dispatch" | "accounts" | "vendor" | "viewer";

export const ROLES: Role[] = [
  "admin", "sales", "purchase", "inventory", "warehouse", "dispatch", "accounts", "vendor", "viewer",
];

// A leaf is a single page (a link). A folder is a module that opens a flyout
// submenu listing its pages/"reports" (e.g. Packing → Slip / Saved / Live).
export type NavItem = { href: string; label: string; icon: string; roles: Role[] | "all" };
export type NavFolder = { label: string; icon: string; children: NavItem[] };
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
    ],
  },
  {
    group: "Workspaces",
    items: [
      {
        label: "Scanning", icon: "▣",
        children: [
          { href: "/erp/scan", label: "QR Scanner", icon: "▣", roles: ["admin", "warehouse", "dispatch", "inventory"] },
          { href: "/erp/scan/dispatch", label: "Pack & Dispatch", icon: "⇪", roles: ["admin", "warehouse", "dispatch"] },
          { href: "/erp/qr", label: "QR Codes", icon: "❒", roles: ["admin", "warehouse", "inventory"] },
          { href: "/erp/scan/history", label: "Scan History", icon: "≣", roles: ["admin", "warehouse", "dispatch", "inventory", "accounts"] },
        ],
      },
      {
        label: "Packing", icon: "▤",
        children: [
          { href: "/erp/packing-slip", label: "Packing Slip", icon: "▤", roles: ["admin", "warehouse", "dispatch"] },
          { href: "/erp/packing-slip/saved", label: "Saved Slips", icon: "🗂", roles: ["admin", "warehouse", "dispatch", "accounts", "sales"] },
          { href: "/erp/packing-slip/live", label: "Live View", icon: "📺", roles: ["admin", "warehouse", "dispatch"] },
        ],
      },
      {
        label: "Inventory", icon: "▦",
        children: [
          { href: "/erp/skus", label: "SKU Master", icon: "▦", roles: ["admin", "inventory", "warehouse", "sales", "purchase"] },
          { href: "/erp/skus/import", label: "Import SKUs", icon: "⬆", roles: ["admin", "inventory"] },
          { href: "/erp/skus/import-labels", label: "Backfill Barcode Info", icon: "⬆", roles: ["admin", "inventory"] },
          { href: "/erp/labels", label: "Barcode Labels", icon: "🏷", roles: ["admin", "inventory", "warehouse"] },
          { href: "/erp/inventory", label: "Stock", icon: "≡", roles: ["admin", "inventory", "warehouse", "sales"] },
          { href: "/erp/warehouses", label: "Warehouses", icon: "⊞", roles: ["admin", "inventory", "warehouse"] },
        ],
      },
      {
        label: "Master Files", icon: "🗎",
        children: [
          { href: "/erp/customers", label: "Customer Master", icon: "☻", roles: ["admin", "sales", "accounts"] },
          { href: "/erp/vendors", label: "Vendor Master", icon: "⚒", roles: ["admin", "purchase", "accounts", "vendor"] },
          { href: "/erp/skus", label: "Item (SKU) Master", icon: "▦", roles: ["admin", "inventory", "warehouse", "sales", "purchase"] },
          { href: "/erp/masters/party-rates", label: "Party-wise Net Rate", icon: "₹", roles: ["admin", "sales", "accounts"] },
          { href: "/erp/masters/item-rates", label: "Item-wise Net Rate", icon: "₹", roles: ["admin", "sales", "accounts", "inventory"] },
          { href: "/erp/masters/import", label: "Upload / Overwrite (Excel)", icon: "⬆", roles: ["admin", "sales", "accounts", "purchase", "inventory"] },
        ],
      },
      {
        label: "Sales", icon: "↗",
        children: [
          { href: "/erp/sales", label: "Sales Orders", icon: "↗", roles: ["admin", "sales", "dispatch", "accounts"] },
          { href: "/erp/deliveries", label: "Delivery Orders", icon: "🚚", roles: ["admin", "sales", "dispatch", "warehouse", "accounts"] },
          { href: "/erp/invoices", label: "Invoices", icon: "🧾", roles: ["admin", "sales", "accounts", "dispatch"] },
          { href: "/erp/customers", label: "Customers", icon: "☻", roles: ["admin", "sales", "accounts"] },
        ],
      },
      {
        label: "Purchase", icon: "↙",
        children: [
          { href: "/erp/purchase", label: "Purchase Orders", icon: "↙", roles: ["admin", "purchase", "accounts"] },
          { href: "/erp/grn", label: "Goods Receipts", icon: "📥", roles: ["admin", "purchase", "warehouse", "accounts"] },
          { href: "/erp/vendor-bills", label: "Vendor Bills", icon: "🧾", roles: ["admin", "purchase", "accounts"] },
          { href: "/erp/vendors", label: "Vendors", icon: "⚒", roles: ["admin", "purchase", "accounts", "vendor"] },
        ],
      },
      {
        label: "Finance & Reports", icon: "₹",
        children: [
          { href: "/erp/finance", label: "Finance", icon: "₹", roles: ["admin", "accounts"] },
          { href: "/erp/reports", label: "Reports", icon: "▤", roles: ["admin", "sales", "purchase", "accounts", "inventory"] },
        ],
      },
      {
        label: "Administration", icon: "⚿",
        children: [
          { href: "/erp/users", label: "Users & Roles", icon: "⚿", roles: ["admin"] },
          { href: "/connection", label: "Oracle Link", icon: "⚙", roles: ["admin", "accounts"] },
        ],
      },
    ],
  },
];

export function isFolder(e: NavEntry): e is NavFolder {
  return (e as NavFolder).children !== undefined;
}

export function canSee(role: Role, item: NavItem): boolean {
  return item.roles === "all" || item.roles.includes(role);
}

// Children of a folder this role may see (empty → hide the whole folder).
export function visibleChildren(role: Role, folder: NavFolder): NavItem[] {
  return folder.children.filter((c) => canSee(role, c));
}

// Every leaf page in the nav, folders flattened out — used by the access matrix.
export function leafNavItems(): NavItem[] {
  return NAV.flatMap((g) => g.items.flatMap((e) => (isFolder(e) ? e.children : [e])));
}

// Write/approve capability per role (used to gate mutating actions).
const WRITERS: Record<string, Role[]> = {
  scan: ["admin", "warehouse", "dispatch", "inventory"],
  skus: ["admin", "inventory"],
  inventory: ["admin", "inventory", "warehouse"],
  sales: ["admin", "sales"],
  dispatch: ["admin", "dispatch", "warehouse"],
  purchase: ["admin", "purchase"],
  vendors: ["admin", "purchase"],
  customers: ["admin", "sales"],
  invoices: ["admin", "accounts", "sales"],
  users: ["admin"],
  labels: ["admin", "inventory", "warehouse"],
  rates: ["admin", "sales", "accounts"],
};

export function canWrite(role: Role, module: keyof typeof WRITERS): boolean {
  return role === "admin" || (WRITERS[module]?.includes(role) ?? false);
}

export function roleLabel(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
