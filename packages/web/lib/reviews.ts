// SPEC-6 §3 — dashboard data source: the agent service's token-gated
// GET /reviews/:owner/:repo. Server-side ONLY (invariants 18/19): the token
// (env REXTOR_AGENT_TOKEN) never reaches the browser — this module runs in
// server components / route handlers, never in client code.
//
// Row fields are the binding SPEC-6 §3 schema, verbatim snake_case from the
// service. Every string is untrusted PR-derived data: rendered as inert text
// only (React escaping), never as markup.

export interface ReviewRow {
  repo: string;
  pr: number;
  head_sha: string;
  review_id: string;
  chain: string;
  tx_hash: string;
  explorer_url: string;
  risk_score: number;
  finding_count: number;
  status: number;
  comment_url: string;
  created_at: string;
}

/** Honest result: data OR a reason — the page never guesses. */
export type ReviewsResult = { ok: true; rows: ReviewRow[] } | { ok: false; reason: string };

/** Per-row shape check at the trust boundary: one malformed row (partial
 *  write, schema drift) must degrade that ROW, not 500 the whole dashboard
 *  page with a TypeError on an undefined field. Consumers index fields
 *  unguarded, so the boundary guarantees the shape they rely on. */
function isReviewRow(v: unknown): v is ReviewRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.repo === "string" &&
    typeof r.pr === "number" &&
    typeof r.head_sha === "string" &&
    typeof r.review_id === "string" &&
    typeof r.chain === "string" &&
    typeof r.tx_hash === "string" &&
    typeof r.explorer_url === "string" &&
    typeof r.risk_score === "number" &&
    typeof r.finding_count === "number" &&
    typeof r.status === "number" &&
    typeof r.comment_url === "string" &&
    typeof r.created_at === "string"
  );
}

/** Render cap: the dashboard is force-dynamic — a repo with thousands of
 *  reviews would render every row per request (self-inflicted cost). */
export const MAX_RENDERED_ROWS = 200;

export interface FetchReviewsOptions {
  /** Default: env REXTOR_AGENT_URL (service base, no trailing slash needed). */
  baseUrl?: string;
  /** Default: env REXTOR_AGENT_TOKEN. */
  token?: string;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export async function fetchReviews(
  owner: string,
  repo: string,
  opts: FetchReviewsOptions = {},
): Promise<ReviewsResult> {
  const baseUrl = (opts.baseUrl ?? process.env.REXTOR_AGENT_URL ?? "").replace(/\/+$/, "");
  const token = opts.token ?? process.env.REXTOR_AGENT_TOKEN;
  if (!baseUrl) return { ok: false, reason: "REXTOR_AGENT_URL is not configured" };
  if (!token) return { ok: false, reason: "REXTOR_AGENT_TOKEN is not configured" };

  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(
      `${baseUrl}/reviews/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: { "X-API-Token": token }, signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    return { ok: false, reason: "review index unreachable" };
  }
  if (!res.ok) return { ok: false, reason: `review index answered ${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "review index returned invalid JSON" };
  }
  if (typeof body !== "object" || body === null || !("reviews" in body)) {
    return { ok: false, reason: "review index returned an unexpected shape" };
  }
  const reviews: unknown = body.reviews;
  if (!Array.isArray(reviews)) return { ok: false, reason: "review index returned an unexpected shape" };
  return { ok: true, rows: reviews.filter(isReviewRow).slice(0, MAX_RENDERED_ROWS) };
}
