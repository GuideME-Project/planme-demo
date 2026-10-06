import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { isPlanmeOriginVerified } from "./planme-origin-verify";

/**
 * Returns the visitor address. Behind Cloudflare this is CF-Connecting-IP, which Cloudflare always overwrites,
 * but it is trusted only when the origin-verify header proves the request came through Cloudflare.
 * Otherwise it is the client address added by the ALB, which is the last X-Forwarded-For entry.
 * The ALB appends to (rather than replaces) a client-supplied header, so earlier entries are spoofable.
 */
export function getTrustedClientAddress(request: Request) {
  if (isPlanmeOriginVerified(request.headers)) {
    const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim() ?? "";
    if (isIP(cloudflareAddress)) return cloudflareAddress;
  }

  const entries = request.headers.get("x-forwarded-for")?.split(",") ?? [];
  const last = entries[entries.length - 1]?.trim() ?? "";

  // Drop an optional client port, e.g. `203.0.113.7:8080` or `[2001:db8::1]:8080`.
  const address = last.replace(/^\[([^\]]+)\](?::\d+)?$/, "$1").replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1");

  return address || "local";
}

/** Hashes the client address so rate-limit storage never contains a raw IP. */
export function createClientAddressHash(request: Request) {
  return createHash("sha256").update(getTrustedClientAddress(request)).digest("hex").slice(0, 16);
}
