// SPEC-6 §3 — score history: one severity-tinted bar per review, real
// risk_score values (width = score%, danger ≥ 60 per the rubric's critical
// weight, warning below). Oldest → newest, like the approved mock.
import type { ReviewRow } from "@/lib/reviews";

const DANGER_THRESHOLD = 60;

export function ScoreHistory({ rows }: { rows: ReviewRow[] }) {
  const chronological = [...rows].reverse();
  return (
    <section aria-label="Score history" className="block py-6 pb-10">
      <h2 className="mb-4 font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
        Score history
      </h2>
      <div className="grid grid-cols-1 gap-4 min-[40rem]:grid-cols-3">
        {chronological.map((row) => (
          <div key={`${row.pr}-${row.head_sha}-${row.created_at}`} className="min-w-0">
            <div className="h-6 overflow-hidden rounded-[2px] bg-elevated">
              <div
                className={`h-full ${row.risk_score >= DANGER_THRESHOLD ? "bg-danger" : "bg-warning"}`}
                style={{ width: `${Math.min(Math.max(row.risk_score, 0), 100)}%` }}
              />
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
              PR #{row.pr} · {row.risk_score} — {row.tx_hash ? "attested" : "not attested"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
