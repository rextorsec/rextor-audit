// Per-request nonce CSP (roast 2026-09-25 #1). The middleware mints a
// one-use nonce and sets the policy on BOTH headers: the request headers
// (Next reads the policy from there and stamps its inline bootstrap scripts
// with the nonce) and the response headers (the browser enforces it). Pages
// the policy covers must render per request so the stamped nonce matches —
// a build-time-cached HTML would embed scripts no live nonce can vouch for.
import { NextResponse, type NextRequest } from "next/server";

import { buildScriptCsp } from "@/lib/csp";

export function middleware(request: NextRequest): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildScriptCsp(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Everything except immutable static assets (same-origin files, not inline
  // scripts — no nonce to vouch for).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
