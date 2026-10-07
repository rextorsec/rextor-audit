// SPEC-6 §3 (dashboard v2, approved mock) — pure derivations from review
// rows. Rows arrive newest-first (service ORDER BY created_at DESC); every
// function here treats them as data only. No fetch, no React — trivially
// testable math for the metrics strip and the score-history window.
import type { ReviewRow } from "@/lib/reviews";

export interface DashboardMetrics {
  /** status=0 runs. */
  completeRuns: number;
  /** Of the complete runs, how many carry an attestation tx. */
  attestedOfComplete: number;
  /** Distinct PR numbers reviewed. */
  prsAudited: number;
  /** "2026-09-19 → 10-05" over ALL rows (oldest → newest), null when empty. */
  prRange: string | null;
  /** status=1 runs. */
  incompleteRuns: number;
  /** Date (YYYY-MM-DD) of the newest INCOMPLETE run, null when none. */
  lastIncompleteDate: string | null;
  /** Complete runs newer than the newest INCOMPLETE run (0 when none). */
  completeSinceLastIncomplete: number;
  /** Nearest-rank median/P75/P90 over complete runs' risk scores; null
   *  when there are no complete runs (never fabricated from n=0). */
  distribution: { median: number; p75: number; p90: number; n: number } | null;
}

/** Nearest-rank percentile over ascending-sorted scores: ceil(q·n)-th value. */
function nearestRank(sorted: number[], q: number): number {
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1];
}

export function computeMetrics(rows: ReviewRow[]): DashboardMetrics {
  const complete = rows.filter((row) => row.status === 0);
  const incomplete = rows.filter((row) => row.status !== 0);

  let prRange: string | null = null;
  if (rows.length > 0) {
    // Rows are newest-first; the range is oldest → newest by created_at.
    const dates = rows.map((row) => row.created_at).sort();
    const oldest = dates[0];
    const newest = dates[dates.length - 1];
    const short = (iso: string) => iso.slice(5, 10);
    prRange =
      oldest.slice(0, 4) === newest.slice(0, 4)
        ? `${oldest.slice(0, 10)} → ${short(newest)}`
        : `${oldest.slice(0, 10)} → ${newest.slice(0, 10)}`;
  }

  let distribution: DashboardMetrics["distribution"] = null;
  if (complete.length > 0) {
    const scores = complete.map((row) => row.risk_score).sort((a, b) => a - b);
    distribution = {
      median: nearestRank(scores, 0.5),
      p75: nearestRank(scores, 0.75),
      p90: nearestRank(scores, 0.9),
      n: complete.length,
    };
  }

  return {
    completeRuns: complete.length,
    attestedOfComplete: complete.filter((row) => row.tx_hash.length > 0).length,
    prsAudited: new Set(rows.map((row) => row.pr)).size,
    prRange,
    incompleteRuns: incomplete.length,
    lastIncompleteDate: incomplete[0]?.created_at.slice(0, 10) ?? null,
    completeSinceLastIncomplete: countLeadingComplete(rows),
    distribution,
  };
}

/** Newest-first walk: complete runs until the first INCOMPLETE row. */
function countLeadingComplete(rows: ReviewRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (row.status !== 0) break;
    count += 1;
  }
  return count;
}

/** Last N complete runs in display order (oldest → newest of that window). */
export function lastCompleteRuns(rows: ReviewRow[], n: number): ReviewRow[] {
  return rows.filter((row) => row.status === 0).slice(0, n).reverse();
}
