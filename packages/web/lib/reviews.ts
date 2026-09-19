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
      { headers: { "X-API-Token": token } },
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
  const reviews = (body as { reviews?: unknown }).reviews;
  if (!Array.isArray(reviews)) return { ok: false, reason: "review index returned an unexpected shape" };
  return { ok: true, rows: reviews as ReviewRow[] };
}
