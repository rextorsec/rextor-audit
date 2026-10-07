// SPEC-6 §3 (dashboard v2) — the agent service's token-gated
// GET /dismissals/:owner/:repo (server-side dismissal memory, invariant 21).
// Same posture as fetchReviews: the token never reaches the browser, every
// failure degrades to an honest reason, rows are untrusted text rendered
// inert by React.
export interface DismissalRow {
  rule_id: string;
  path: string;
}

export type DismissalsResult = { ok: true; rows: DismissalRow[] } | { ok: false; reason: string };

function isDismissalRow(v: unknown): v is DismissalRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.rule_id === "string" && typeof r.path === "string";
}

export interface FetchDismissalsOptions {
  /** Default: env REXTOR_AGENT_URL (service base). */
  baseUrl?: string;
  /** Default: env REXTOR_AGENT_TOKEN. */
  token?: string;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export async function fetchDismissals(
  owner: string,
  repo: string,
  opts: FetchDismissalsOptions = {},
): Promise<DismissalsResult> {
  const baseUrl = (opts.baseUrl ?? process.env.REXTOR_AGENT_URL ?? "").replace(/\/+$/, "");
  const token = opts.token ?? process.env.REXTOR_AGENT_TOKEN;
  if (!baseUrl) return { ok: false, reason: "REXTOR_AGENT_URL is not configured" };
  if (!token) return { ok: false, reason: "REXTOR_AGENT_TOKEN is not configured" };

  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(
      `${baseUrl}/dismissals/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: { "X-API-Token": token }, signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    return { ok: false, reason: "dismissal memory unreachable" };
  }
  if (!res.ok) return { ok: false, reason: `dismissal memory answered ${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "dismissal memory returned invalid JSON" };
  }
  if (typeof body !== "object" || body === null || !("dismissals" in body)) {
    return { ok: false, reason: "dismissal memory returned an unexpected shape" };
  }
  const dismissals: unknown = body.dismissals;
  if (!Array.isArray(dismissals)) return { ok: false, reason: "dismissal memory returned an unexpected shape" };
  return { ok: true, rows: dismissals.filter(isDismissalRow) };
}
