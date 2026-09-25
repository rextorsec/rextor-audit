// Roast 2026-09-25 #1 (second half) — the ONE Content-Security-Policy
// definition for the site, consumed by middleware.ts. script-src is
// nonce-based with strict-dynamic: Next stamps the nonce onto its bootstrap
// scripts via the request header the middleware sets, so 'unsafe-inline'
// scripts are gone for good. style-src keeps 'unsafe-inline' — App Router +
// geist inject inline styles, and style injection is not executable. `dev`
// adds 'unsafe-eval' for next-dev HMR only; production never sees it.
export function buildScriptCsp(nonce: string, dev = false): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(dev ? ["'unsafe-eval'"] : []),
  ].join(" ");
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}
