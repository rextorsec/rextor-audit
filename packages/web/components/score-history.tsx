// SPEC-6 §3 (dashboard v2, approved mock) — score history: the last 6
// COMPLETE runs, one severity-tinted bar each, oldest → newest like the mock.
// Real risk_score values only (width = score%, danger ≥ 60 per the rubric's
// critical weight); INCOMPLETE runs never draw a bar (score 0 is not data).
import { lastCompleteRuns } from "@/lib/metrics";
import type { ReviewRow } from "@/lib/reviews";

const DANGER_THRESHOLD = 60;
const WINDOW = 6;

export function ScoreHistory({ rows }: { rows: ReviewRow[] }) {
  const complete = rows.filter((row) => row.status === 0);
  const window = lastCompleteRuns(rows, WINDOW);
  if (window.length === 0) return null;
  return (
    <section aria-label="Score history" className="block py-6 pb-10">
      <h2 className="mb-4 font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
        Score history · last {window.length} complete run{window.length === 1 ? "" : "s"}
        {complete.length > window.length ? ` (of ${complete.length})` : ""}
      </h2>
      <div className="grid grid-cols-1 gap-4 min-[30rem]:grid-cols-3 min-[48rem]:grid-cols-6">
        {window.map((row) => (
          <div key={`${row.pr}-${row.head_sha}-${row.created_at}`} className="min-w-0">
            <div className="h-6 overflow-hidden rounded-[2px] bg-elevated">
              <div
                className={`h-full ${row.risk_score >= DANGER_THRESHOLD ? "bg-danger" : "bg-warning"}`}
                style={{ width: `${Math.min(Math.max(row.risk_score, 0), 100)}%` }}
              />
            </div>
            <p className="mt-1 overflow-hidden font-mono text-xs text-ellipsis whitespace-nowrap text-muted-foreground tabular-nums">
              #{row.pr} · {row.risk_score} · {row.created_at.slice(5, 10)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
