// SPEC-6 §3 (dashboard v2, approved mock) — metrics strip: populated tiles,
// zeros stay visible (an INCOMPLETE tile reading 0 is information, not an
// empty state). All values derive from the real review rows via lib/metrics;
// absent derivations render "—", never a guess.
import { computeMetrics, type DashboardMetrics } from "@/lib/metrics";
import type { ReviewRow } from "@/lib/reviews";

function Tile({ value, label, note, good }: { value: string; label: string; note: string; good?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-6 py-4">
      <p className={`font-mono text-2xl font-medium leading-[1.15] tabular-nums ${good ? "text-success" : ""}`}>
        {value}
      </p>
      <p className="mt-1 font-mono text-xs tracking-[0.08em] uppercase whitespace-nowrap text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xs text-subtle-foreground">{note}</p>
    </div>
  );
}

export function MetricsStrip({ rows }: { rows: ReviewRow[] }) {
  const m: DashboardMetrics = computeMetrics(rows);
  const consecutiveNote =
    m.lastIncompleteDate === null
      ? "no INCOMPLETE runs on record"
      : m.completeSinceLastIncomplete === 0
        ? "newest run is INCOMPLETE"
        : `${m.completeSinceLastIncomplete} consecutive complete run${m.completeSinceLastIncomplete === 1 ? "" : "s"} since`;
  return (
    <section aria-label="Review metrics" className="py-6 pb-10">
      <h2 className="mb-4 font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
        Review metrics
      </h2>
      <div className="grid grid-cols-1 gap-4 min-[30rem]:grid-cols-2 min-[48rem]:grid-cols-4">
        <Tile
          value={String(m.attestedOfComplete)}
          label="Attested reviews"
          note={
            m.completeRuns === 0
              ? "no complete runs yet"
              : `of ${m.completeRuns} complete run${m.completeRuns === 1 ? "" : "s"}` +
                (m.completeRuns - m.attestedOfComplete > 0
                  ? ` — ${m.completeRuns - m.attestedOfComplete} predates attestation`
                  : "")
          }
        />
        <Tile
          value={String(m.prsAudited)}
          label="PRs audited"
          note={m.prRange ?? "—"}
        />
        <Tile
          value={String(m.incompleteRuns)}
          label="INCOMPLETE runs"
          note={m.lastIncompleteDate === null ? "none on record" : `last on ${m.lastIncompleteDate}`}
        />
        <Tile
          value={m.lastIncompleteDate === null ? String(m.completeSinceLastIncomplete) : "0"}
          label={m.lastIncompleteDate === null ? "Complete runs" : `INCOMPLETE since ${m.lastIncompleteDate}`}
          note={consecutiveNote}
          good={m.lastIncompleteDate === null || m.completeSinceLastIncomplete > 0}
        />
      </div>
      {m.distribution && (
        <div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-muted-foreground">
          <span>complete-run distribution · n = {m.distribution.n}</span>
          <span className="rounded-full border border-border px-3 py-0.5 whitespace-nowrap">
            median {m.distribution.median}
          </span>
          <span className="rounded-full border border-border px-3 py-0.5 whitespace-nowrap">
            P75 {m.distribution.p75}
          </span>
          <span className="rounded-full border border-border px-3 py-0.5 whitespace-nowrap">
            P90 {m.distribution.p90}
          </span>
        </div>
      )}
    </section>
  );
}
