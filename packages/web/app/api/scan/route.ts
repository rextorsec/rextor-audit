// SPEC-6 §3 — POST /api/scan: the browser-facing proxy to the agent service's
// SYNCHRONOUS whole-repo scan (POST {REXTOR_AGENT_URL}/scan, minutes per run).
// Server-only: REXTOR_AGENT_TOKEN is read from env here and rides only on the
// upstream request — it never reaches the browser, any response body, or any
// log (invariants 18/19). The service response passes through STATUS-VERBATIM:
// 401/400/409/413/500 bodies are forwarded untouched; a 200 body (ScanReport)
// is forwarded untouched. This route never re-interprets a verdict.
//
// Hard gate FIRST: the dashboard is public (no auth). Un-gated, this route
// would let an anonymous visitor drive arbitrary-repo clones + minutes of
// container compute and hold the service-wide scan single-flight (409ing
// everyone else). Enabling it via REXTOR_SCAN_TRIGGER_ENABLED=1 is an explicit
// operator decision; the default is OFF.

import { checkScanAccess, resolveRateMax } from "@/lib/scan-gate";

// The scan is synchronous and container-time is accepted: this function may
// legitimately run for minutes (Vercel Fluid max). 290s of upstream timeout
// leaves headroom under the 300s ceiling for the response hop.
export const maxDuration = 300;

const UPSTREAM_TIMEOUT_MS = 290_000;

export async function POST(req: Request): Promise<Response> {
  if (process.env.REXTOR_SCAN_TRIGGER_ENABLED !== "1") {
    return Response.json(
      { error: "scan trigger is disabled on this deployment" },
      { status: 503 },
    );
  }

  const baseUrl = (process.env.REXTOR_AGENT_URL ?? "").replace(/\/+$/, "");
  const token = process.env.REXTOR_AGENT_TOKEN;
  if (!baseUrl) {
    return Response.json({ error: "REXTOR_AGENT_URL is not configured" }, { status: 500 });
  }
  if (!token) {
    return Response.json({ error: "REXTOR_AGENT_TOKEN is not configured" }, { status: 500 });
  }

  // Abuse model (see the hard-gate comment above): this is still a PUBLIC
  // route, so an enabled trigger means anonymous compute that can hold the
  // service-wide single-flight (409ing everyone else). The per-IP window
  // bounds that; REXTOR_SCAN_DEMO_KEY lifts it for the demo (timing-safe
  // compare). The window is in-memory — per server instance, reset on
  // restart, not distributed-attack-proof — the service-side single-flight
  // (409) bounds the remaining blast radius.
  const gate = checkScanAccess(req, {
    enabled: true,
    demoKey: process.env.REXTOR_SCAN_DEMO_KEY || undefined,
    rateMax: resolveRateMax(process.env.REXTOR_SCAN_RATE_MAX),
  });
  if (!gate.ok) {
    return Response.json(
      { error: gate.error },
      { status: gate.status, headers: { "Retry-After": String(gate.retryAfterSeconds) } },
    );
  }

  // The service validates {repo, ref} authoritatively (400) and enforces the
  // service-wide single-flight (409): forward the body untouched rather than
  // pre-judging it, so the client always sees the service's own status.
  let body: string;
  try {
    body = await req.text();
  } catch {
    return Response.json({ error: "unreadable request body" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/scan`, {
      method: "POST",
      headers: { "X-API-Token": token, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    // Vercel function-cap reality (hobby plan caps at 60s): the response can
    // die long before the scan does. The service keeps running either way and
    // the settled row still lands in the scans ledger (GET /scans) — so the
    // honest answer points at the receipt, it does not claim failure.
    const errName = (err as { name?: string } | null)?.name;
    if (errName === "TimeoutError") {
      return Response.json(
        { error: "scan still running server-side — check the scans ledger" },
        { status: 504 },
      );
    }
    return Response.json({ error: "scan service unreachable" }, { status: 502 });
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
}
