import { NextRequest, NextResponse } from "next/server";
import { defaultLocale, isLocale } from "./lib/i18n/routing";
import { shouldRejectUnverifiedOrigin } from "./lib/planme-origin-verify";

/** Paths that need locale handling; every other path only passes through the origin verification. */
const LOCALE_ROUTE_PATTERN = /^\/(?:itinerary|ko|en)(?:\/|$)/;

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // The ALB health check carries no Cloudflare header, so it is exempt from origin verification.
  if (path !== "/api/health" && shouldRejectUnverifiedOrigin(request.headers)) {
    return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (path !== "/" && !LOCALE_ROUTE_PATTERN.test(path)) return NextResponse.next();

  const segment = path.split("/")[1];
  if (path === "/" || path.startsWith("/itinerary/")) {
    const preferred = request.cookies.get("planme-locale")?.value ?? defaultLocale;
    const locale = isLocale(preferred) ? preferred : defaultLocale;
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${path === "/" ? "" : path}`;
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const headers = new Headers(request.headers);
  headers.set("x-planme-locale", isLocale(segment) ? segment : defaultLocale);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static build assets and public images skip the proxy; everything else is checked for the Cloudflare origin header.
  // The image optimizer fetches public images internally without that header, so they must stay outside the check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico)$).*)"],
};
