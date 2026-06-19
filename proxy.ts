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

  if (!session) {
    if (isLogin || isAuthApi) return NextResponse.next();
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
  matcher: ["/((?!_next/static|_next/image|icon.svg|apple-icon.png|favicon.ico|robots.txt|sitemap.xml).*)"],
};
