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
          { key: "Content-Security-Policy", value: CSP },
          // MIME confusion: never sniff responses as HTML.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

// App Router ships framework bootstrap + RSC payload as inline <script>s, so
// script-src needs 'unsafe-inline' — the CSP still pins object/base/frame
// (the XSS second layer) until a nonce-based policy lands with the 15.x
// upgrade. HTTPS/HSTS is enforced platform-side on Vercel.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export default nextConfig;
