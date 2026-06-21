// Roles, module access, and the ERP navigation map (single source of truth).
export type Role =
  | "admin" | "sales" | "purchase" | "inventory" | "warehouse"
  | "dispatch" | "accounts" | "vendor" | "viewer";

export const ROLES: Role[] = [
  "admin", "sales", "purchase", "inventory", "warehouse", "dispatch", "accounts", "vendor", "viewer",
];

export type NavItem = { href: string; label: string; icon: string; roles: Role[] | "all" };
export type NavGroup = { group: string; items: NavItem[] };

const ALL: "all" = "all";

export const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { href: "/", label: "Home", icon: "⌂", roles: ALL },
      { href: "/erp", label: "ERP Dashboard", icon: "▥", roles: ALL },
      { href: "/erp/activity", label: "Activity Feed", icon: "⚡", roles: ALL },
    ],
  },
  {
    group: "Scanning",
    items: [
      { href: "/erp/scan", label: "QR Scanner", icon: "▣", roles: ["admin", "warehouse", "dispatch", "inventory"] },
      { href: "/erp/scan/dispatch", label: "Pack & Dispatch", icon: "⇪", roles: ["admin", "warehouse", "dispatch"] },
      { href: "/erp/packing-slip", label: "Packing Slip", icon: "▤", roles: ["admin", "warehouse", "dispatch"] },
      { href: "/erp/packing-slip/saved", label: "Saved Slips", icon: "🗂", roles: ["admin", "warehouse", "dispatch", "accounts", "sales"] },
      { href: "/erp/packing-slip/live", label: "Packing Slip (Live)", icon: "📺", roles: ["admin", "warehouse", "dispatch"] },
      { href: "/erp/qr", label: "QR Codes", icon: "❒", roles: ["admin", "warehouse", "inventory"] },
      { href: "/erp/scan/history", label: "Scan History", icon: "≣", roles: ["admin", "warehouse", "dispatch", "inventory", "accounts"] },
    ],
  },
  {
    group: "Inventory",
    items: [
      { href: "/erp/skus", label: "SKU Master", icon: "▦", roles: ["admin", "inventory", "warehouse", "sales", "purchase"] },
      { href: "/erp/skus/import", label: "Import SKUs", icon: "⬆", roles: ["admin", "inventory"] },
      { href: "/erp/inventory", label: "Stock", icon: "≡", roles: ["admin", "inventory", "warehouse", "sales"] },
      { href: "/erp/warehouses", label: "Warehouses", icon: "⊞", roles: ["admin", "inventory", "warehouse"] },
    ],
  },
  {
    group: "Sales",
    items: [
      { href: "/erp/sales", label: "Sales Orders", icon: "↗", roles: ["admin", "sales", "dispatch", "accounts"] },
      { href: "/erp/invoices", label: "Invoices", icon: "🧾", roles: ["admin", "sales", "accounts", "dispatch"] },
      { href: "/erp/customers", label: "Customers", icon: "☻", roles: ["admin", "sales", "accounts"] },
    ],
  },
  {
    group: "Purchase",
    items: [
      { href: "/erp/purchase", label: "Purchase Orders", icon: "↙", roles: ["admin", "purchase", "accounts"] },
      { href: "/erp/vendors", label: "Vendors", icon: "⚒", roles: ["admin", "purchase", "accounts", "vendor"] },
    ],
  },
  {
    group: "Finance & Reports",
    items: [
      { href: "/erp/finance", label: "Finance", icon: "₹", roles: ["admin", "accounts"] },
      { href: "/erp/reports", label: "Reports", icon: "▤", roles: ["admin", "sales", "purchase", "accounts", "inventory"] },
    ],
  },
  {
    group: "Administration",
    items: [
      { href: "/erp/users", label: "Users & Roles", icon: "⚿", roles: ["admin"] },
      { href: "/connection", label: "Oracle Link", icon: "⚙", roles: ["admin", "accounts"] },
    ],
  },
];

export function canSee(role: Role, item: NavItem): boolean {
  return item.roles === "all" || item.roles.includes(role);
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
};

export function canWrite(role: Role, module: keyof typeof WRITERS): boolean {
  return role === "admin" || (WRITERS[module]?.includes(role) ?? false);
}

export function roleLabel(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
