// SPEC-6 §3 (dashboard v2, approved mock) — dismissal memory: the real
// server-side count (invariant 21: repo-keyed SQLite, never a repo file) with
// the honest rule text. A failed read renders the reason, never a guessed 0 —
// "0 dismissals" is a claim; "unavailable" is not.
import type { DismissalsResult } from "@/lib/dismissals";

export function DismissalsPanel({ result }: { result: DismissalsResult }) {
  return (
    <section aria-label="Dismissal memory" className="py-6 pb-10">
      <h2 className="mb-4 font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
        Dismissal memory
      </h2>
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="font-mono text-2xl font-medium tabular-nums">
          {result.ok ? `${result.rows.length} dismissal${result.rows.length === 1 ? "" : "s"}` : "—"}
        </p>
        <p className="mt-1 max-w-[62ch] text-xs text-muted-foreground">
          Stored server-side, keyed by repo — never in a repo file. PR content cannot silence a
          finding: dismissal requires service-side action from the repo owner, and every dismissal
          is recorded with its rule and path.
        </p>
        {!result.ok && (
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            count unavailable — {result.reason}
          </p>
        )}
      </div>
    </section>
  );
}
