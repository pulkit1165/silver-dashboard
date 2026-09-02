import { NextResponse, type NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/erp/jwt";

// Next 16 "Proxy" (formerly Middleware). Gates everything behind a session
// except the login page + auth APIs.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  const isLogin = pathname === "/login";
  const isAuthApi = pathname.startsWith("/api/erp/auth/");
  // Read-only packing CSV mirror for Google Sheets IMPORTDATA — guarded by its
  // own ?token= (validated in the route), so it must bypass the session gate.
  const isPublicExport = pathname === "/api/erp/packing/export";
  // Meta WhatsApp Cloud API webhook — authenticated by the X-Hub signature /
  // verify token inside the route, so it must bypass the session gate too.
  const isWhatsappWebhook = pathname === "/api/whatsapp/webhook";
  // Self-hosted print agent — machines authenticate with x-agent-token (validated
  // in the route), not a login session, so these must bypass the session gate.
  const isPrintAgent = pathname.startsWith("/api/erp/print/agent/");
  // Public agent installer download (no secrets — the token is entered separately).
  const isAgentDownload = pathname.startsWith("/agent/");
  // Vercel Cron jobs (and their manual-trigger twins) authenticate with
  // Authorization: Bearer <CRON_SECRET> inside the route, not a login session —
  // Vercel's scheduler has no session cookie to send, so this must bypass the gate.
  const isCronRoute = pathname.startsWith("/api/cron/") || pathname === "/api/sync/oracle";

  if (!session) {
    if (isLogin || isAuthApi || isPublicExport || isWhatsappWebhook || isPrintAgent || isAgentDownload || isCronRoute) return NextResponse.next();
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // The retailer firm is locked to the Silver Retailer Network panel only — no
  // access to the rest of the ERP (dashboard, other orders, masters, etc.).
  const RETAILER_HOME = "/erp/sales/silver-retailer-network";
  const isRetailer = session.role === "retailer";

  if (isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = isRetailer ? RETAILER_HOME : "/erp";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (isRetailer && !pathname.startsWith(RETAILER_HOME) && !pathname.startsWith("/api/erp/auth/")) {
    if (pathname.startsWith("/api")) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = RETAILER_HOME;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.png|apple-icon.png|favicon.ico|icons/|manifest.webmanifest|robots.txt|sitemap.xml).*)"],
};
