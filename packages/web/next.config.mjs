/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework version (x-powered-by) publicly.
  poweredByHeader: false,
  // Hardening (2026-09-24): Next 14.2 carries advisories in the image
  // optimization API (incl. the AVIF-optimizer RCE class) reachable by
  // anyone who can hit /_next/image. The app renders no next/image, so the
  // optimizer is dead weight — unoptimized disables the processing surface
  // without touching any page. Post-CWF: upgrade to next@>=15.5.24 (14.x is
  // EOL for security fixes) and revisit.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Clickjacking: the receipts UI is spoofable in a frame; nothing
          // on the site needs framing.
          { key: "X-Frame-Options", value: "DENY" },
          // MIME confusion: never sniff responses as HTML.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

// The Content-Security-Policy moved to middleware.ts (roast 2026-09-25 #1):
// a static header could only say 'unsafe-inline' for scripts. The middleware
// mints a per-request nonce, Next stamps it onto bootstrap scripts, and
// script-src upgrades to 'nonce-…' + 'strict-dynamic'. The non-CSP headers
// stay here — they carry no per-request state.

export default nextConfig;
