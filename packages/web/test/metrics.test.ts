// SPEC-6 §3 (dashboard v2) — pure derivations: nearest-rank percentiles,
// INCOMPLETE accounting, and the history window. The dashboard renders these
// numbers as product claims — the math is pinned here directly.
import { describe, expect, it } from "vitest";

import { computeMetrics, lastCompleteRuns } from "@/lib/metrics";
import type { ReviewRow } from "@/lib/reviews";

const row = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  repo: "o/r",
  pr: 1,
  head_sha: "a".repeat(40),
  review_id: "0x1",
  chain: "Tempo testnet",
  tx_hash: "0x" + "2".repeat(64),
  explorer_url: "",
  risk_score: 50,
  finding_count: 1,
  status: 0,
  comment_url: "",
  created_at: "2026-09-18T00:00:00.000Z",
  ...over,
});

describe("computeMetrics", () => {
  it("nearest-rank percentiles over complete runs' scores", () => {
    // n=10 complete: scores 0..9 ascending. median ceil(5)=5th → 4; P75 ceil(7.5)=8th → 7; P90 ceil(9)=9th → 8.
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ pr: 10 - i, risk_score: i, created_at: `2026-09-${String(28 - i).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const m = computeMetrics(rows);
    expect(m.distribution).toEqual({ median: 4, p75: 7, p90: 8, n: 10 });
  });

  it("INCOMPLETE runs never enter the distribution", () => {
    const rows = [row({ risk_score: 100 }), row({ status: 1, risk_score: 0 })];
    expect(computeMetrics(rows).distribution).toEqual({ median: 100, p75: 100, p90: 100, n: 1 });
  });

  it("n=0 complete runs → null distribution (never fabricated)", () => {
    expect(computeMetrics([row({ status: 1 })]).distribution).toBeNull();
    expect(computeMetrics([]).distribution).toBeNull();
  });

  it("complete-since-incomplete counts only complete runs newer than the newest INCOMPLETE", () => {
    const rows = [
      row({ created_at: "2026-09-28T00:00:00.000Z" }),
      row({ pr: 2, created_at: "2026-09-27T00:00:00.000Z" }),
      row({ pr: 3, status: 1, created_at: "2026-09-26T00:00:00.000Z" }),
      row({ pr: 4, created_at: "2026-09-25T00:00:00.000Z" }),
    ];
    const m = computeMetrics(rows);
    expect(m.completeSinceLastIncomplete).toBe(2);
    expect(m.lastIncompleteDate).toBe("2026-09-26");
    expect(m.incompleteRuns).toBe(1);
  });

  it("attested-of-complete excludes complete-but-unattested rows", () => {
    const m = computeMetrics([row(), row({ pr: 2, tx_hash: "" })]);
    expect(m.completeRuns).toBe(2);
    expect(m.attestedOfComplete).toBe(1);
  });

  it("prsAudited counts distinct PRs; range is oldest → newest, short form same-year", () => {
    const m = computeMetrics([
      row({ pr: 1, created_at: "2026-09-05T00:00:00.000Z" }),
      row({ pr: 1, created_at: "2026-09-06T00:00:00.000Z" }),
      row({ pr: 2, created_at: "2026-10-08T00:00:00.000Z" }),
    ]);
    expect(m.prsAudited).toBe(2);
    expect(m.prRange).toBe("2026-09-05 → 10-08");
  });
});

describe("lastCompleteRuns", () => {
  it("returns the newest n complete runs in oldest-first display order", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ pr: 5 - i, created_at: `2026-09-${String(20 - i).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const window = lastCompleteRuns(rows, 3);
    expect(window.map((r) => r.pr)).toEqual([3, 4, 5]);
  });

  it("skips INCOMPLETE rows entirely", () => {
    const rows = [
      row({ pr: 3 }),
      row({ pr: 2, status: 1 }),
      row({ pr: 1, created_at: "2026-09-01T00:00:00.000Z" }),
    ];
    expect(lastCompleteRuns(rows, 6).map((r) => r.pr)).toEqual([1, 3]);
  });
});
