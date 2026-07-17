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

  if (!session) {
    if (isLogin || isAuthApi || isPublicExport || isWhatsappWebhook) return NextResponse.next();
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/erp";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.png|apple-icon.png|favicon.ico|icons/|manifest.webmanifest|robots.txt|sitemap.xml).*)"],
};
