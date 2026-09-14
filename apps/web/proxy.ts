import { NextRequest, NextResponse } from "next/server";
import { isLocale } from "./lib/i18n/routing";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const segment = path.split("/")[1];
  if (path === "/" || path.startsWith("/itinerary/")) {
    const preferred = request.cookies.get("planme-locale")?.value ?? "ko";
    const locale = path === "/" && isLocale(preferred) ? preferred : "ko";
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${path === "/" ? "" : path}`;
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const headers = new Headers(request.headers);
  headers.set("x-planme-locale", isLocale(segment) ? segment : "ko");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/", "/itinerary/:path*", "/ko/:path*", "/en/:path*"],
};
