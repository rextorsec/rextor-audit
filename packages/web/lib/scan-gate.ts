// Access gate for the public POST /api/scan trigger — server-side ONLY:
// consumed by app/api/scan/route.ts and backed by node:crypto plus
// in-process state, so this module runs in route handlers, never in client
// code.
//
// Abuse model in one line: the dashboard is public (no auth), so an un-gated
// trigger would hand an anonymous visitor arbitrary-repo clones + minutes of
// container compute and the service-wide scan single-flight (409ing everyone
// else). The flag gate (REXTOR_SCAN_TRIGGER_ENABLED, checked FIRST in the
// route) stays the operator's hard OFF switch; when it is ON, this module
// adds two soft layers:
//
//   1. Shared demo key (env REXTOR_SCAN_DEMO_KEY, supplied per-request via
//      the x-scan-key header or ?key=) — a match bypasses the rate limit.
//      Compared timing-safe: both sides are sha256-digested before
//      timingSafeEqual, so comparison timing leaks neither the key nor its
//      length, and a wrong-length guess cannot throw.
//   2. Per-client-IP sliding window (REXTOR_SCAN_RATE_MAX per hour, default
//      3) for everyone else.
//
// HONEST LIMITS: the window is in-memory — per server instance, reset on
// restart/cold start, and NOT distributed-attack-proof (a botnet rotates
// straight past per-IP buckets, and x-forwarded-for is client-spoofable
// wherever the platform does not strip it). The service-side single-flight
// (one scan at a time, 409) bounds the real blast radius; this gate keeps
// casual abuse polite, it does not defend the service.

import { createHash, timingSafeEqual } from "node:crypto";

export const SCAN_RATE_WINDOW_MS = 3_600_000; // 1 hour
export const DEFAULT_SCAN_RATE_MAX = 3;

/** parseInt with a floor: unset, garbage, zero, and negative all fall back to
 *  the default window max — a misconfigured REXTOR_SCAN_RATE_MAX must not
 *  silently open ("0") or brick ("-1") the trigger. */
export function resolveRateMax(raw: string | undefined): number {
  const parsed = parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) || parsed <= 0 ? DEFAULT_SCAN_RATE_MAX : parsed;
}

export interface ScanGateConfig {
  /** Mirrors REXTOR_SCAN_TRIGGER_ENABLED; the route checks the flag FIRST
   *  and only consults this gate once the trigger is enabled. */
  enabled: boolean;
  /** REXTOR_SCAN_DEMO_KEY. Non-empty required for any bypass. */
  demoKey?: string;
  /** Sliding-window max per client IP (resolveRateMax of the env). */
  rateMax: number;
}

export type ScanGateResult =
  | { ok: true }
  | { ok: false; status: 429; error: string; retryAfterSeconds: number };

/** Timing-safe equality: hash both sides, compare the two 32-byte digests.
 *  Constant work regardless of input length — no timing leak, no
 *  short-circuit, and a wrong-length candidate cannot throw (a raw
 *  timingSafeEqual would). */
function keyMatches(candidate: string, expected: string): boolean {
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

/** Original client per platform convention: first x-forwarded-for hop, else
 *  x-real-ip, else "unknown". Header-less callers deliberately share ONE
 *  bucket — the conservative direction (they run out sooner, not later). */
function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Sliding-window log per client IP, holding ADMITTED hits only: a 429
 *  records nothing and extends nothing — expiry alone readmits. */
const hitsByIp = new Map<string, number[]>();

export function checkScanAccess(
  req: Request,
  config: ScanGateConfig,
  // Test seam: injectable clock (defaults to wall time).
  now: () => number = Date.now,
): ScanGateResult {
  // Bypass path: requires a configured non-empty demo key AND a matching
  // header or query value. Anything else takes the rate-limited track, where
  // every attempt — including wrong key guesses — spends budget.
  if (config.demoKey) {
    const headerKey = req.headers.get("x-scan-key");
    const queryKey = new URL(req.url).searchParams.get("key");
    const matched =
      (headerKey !== null && keyMatches(headerKey, config.demoKey)) ||
      (queryKey !== null && keyMatches(queryKey, config.demoKey));
    if (matched) return { ok: true };
  }

  const nowMs = now();
  const ip = clientIp(req);
  const cutoff = nowMs - SCAN_RATE_WINDOW_MS;
  // Prune on every check: timestamps at or before the cutoff no longer count.
  const hits = (hitsByIp.get(ip) ?? []).filter((t) => t > cutoff);

  if (hits.length >= config.rateMax) {
    hitsByIp.set(ip, hits); // rejected attempts record nothing
    // hits[0] is inside the window, so the wait is always ≥ 1s.
    const retryAfterSeconds = Math.ceil((hits[0] + SCAN_RATE_WINDOW_MS - nowMs) / 1000);
    return {
      ok: false,
      status: 429,
      error: "too many scans from your address — try again later",
      retryAfterSeconds,
    };
  }

  hits.push(nowMs);
  hitsByIp.set(ip, hits);
  return { ok: true };
}

/** Test seam — clears all in-memory window state so tests isolate. */
export function resetScanRateLimit(): void {
  hitsByIp.clear();
}
