// SPEC-6 §3 — deep-scan data source: the agent service's token-gated
// GET /scans?repo=owner/repo. Server-side ONLY (invariants 18/19): the token
// (env REXTOR_AGENT_TOKEN) never reaches the browser — this module runs in
// server components / route handlers, never in client code.
//
// Row fields are the service ledger schema, verbatim snake_case. Every string
// is untrusted service/PR-derived data: rendered as inert text only (React
// escaping), never as markup.
//
// Zero-meaningful display: risk_score null renders "—" (never 0); a clean
// pass renders a real "0" findings; an INCOMPLETE row keeps its row (status
// mirrors the on-chain encoding — 0 complete, 1 INCOMPLETE); head_sha ""
// renders "—".
import { MAX_RENDERED_ROWS } from "@/lib/reviews";

export interface ScanRow {
  repo: string;
  ref: string;
  head_sha: string;
  status: number;
  risk_score: number | null;
  finding_count: number;
  created_at: string;
}

/** Canonical PoC payload — packages/agent/src/findings.ts PocInfo, verbatim
 *  (the web side mirrors the service's Finding schema; never loosened to
 *  unknown, so the report view consumes it without casts). */
export interface ScanPocInfo {
  status: "confirmed" | "unproven" | "skipped";
  testSource?: string;
  block?: number;
}

/** One whole-repo scan's full report (POST /scan response body) — shared
 *  contract verbatim; the trigger and report view consume this shape. */
export interface ScanFinding {
  file: string;
  line: number;
  severity: "critical" | "high" | "medium" | "low";
  check: string;
  description: string;
  id?: number;
  triageNote?: string;
  mergedChecks?: string[];
  poc?: ScanPocInfo;
  /** Presentation-only: review-before-applying fix sketch, never attested. */
  suggestedDiff?: string;
  /** Presentation-only: dismissal-memory note, never attested. */
  learningNote?: string;
}

export interface ScanReport {
  repo: string;
  ref: string;
  head_sha: string;
  status: 0 | 1;
  risk_score: number | null;
  finding_count: number;
  findings: ScanFinding[];
  /** Present only when status is 1 — the honest "why". */
  incomplete?: string;
  /** "infra" — not a verdict on the code; "content" — nothing in scope. */
  incompleteCause?: "infra" | "content";
  /** Degraded-analyzer notes; the verdict stands with status 0. */
  degraded?: string[];
}

/** Honest result: data OR a reason — the page never guesses. */
export type ScansResult =
  | { ok: true; rows: ScanRow[] }
  | { ok: false; reason: string };

/** Per-row shape check at the trust boundary: one malformed row (partial
 *  write, schema drift) must degrade that ROW, not 500 the whole dashboard
 *  page with a TypeError on an undefined field. risk_score accepts null AND
 *  number — INCOMPLETE rows settle with no score, and a validator that
 *  demanded a number would drop every one of them. */
export function isScanRow(v: unknown): v is ScanRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.repo === "string" &&
    typeof r.ref === "string" &&
    typeof r.head_sha === "string" &&
    typeof r.status === "number" &&
    (r.risk_score === null || typeof r.risk_score === "number") &&
    typeof r.finding_count === "number" &&
    typeof r.created_at === "string"
  );
}

export interface FetchScansOptions {
  /** Default: env REXTOR_AGENT_URL (service base, no trailing slash needed). */
  baseUrl?: string;
  /** Default: env REXTOR_AGENT_TOKEN. */
  token?: string;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export async function fetchScans(
  owner: string,
  repo: string,
  opts: FetchScansOptions = {},
): Promise<ScansResult> {
  const baseUrl = (opts.baseUrl ?? process.env.REXTOR_AGENT_URL ?? "").replace(/\/+$/, "");
  const token = opts.token ?? process.env.REXTOR_AGENT_TOKEN;
  if (!baseUrl) return { ok: false, reason: "REXTOR_AGENT_URL is not configured" };
  if (!token) return { ok: false, reason: "REXTOR_AGENT_TOKEN is not configured" };

  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(
      `${baseUrl}/scans?repo=${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: { "X-API-Token": token }, signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    return { ok: false, reason: "scan index unreachable" };
  }
  if (!res.ok) return { ok: false, reason: `scan index answered ${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "scan index returned invalid JSON" };
  }
  if (typeof body !== "object" || body === null || !("scans" in body)) {
    return { ok: false, reason: "scan index returned an unexpected shape" };
  }
  const scans: unknown = (body as Record<string, unknown>).scans;
  if (!Array.isArray(scans)) {
    return { ok: false, reason: "scan index returned an unexpected shape" };
  }
  // Unknown repo → the service answers 200 {scans: []} — an empty ledger is
  // a real state, not a failure.
  return { ok: true, rows: scans.filter(isScanRow).slice(0, MAX_RENDERED_ROWS) };
}
