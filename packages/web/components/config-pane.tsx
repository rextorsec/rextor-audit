// SPEC-6 §3 (dashboard v2, approved mock) — config live-preview: two panes,
// knobs left / rendered artifact right. Left shows the repo's REAL
// rextor.yaml (default branch, trusted) or, when absent/unreadable, the
// documented sample knobs labelled as such. Right shows a REAL rendered
// receipt (the sip-protocol#1267 review) — receipts-not-claims everywhere.
import { SAMPLE_REXTOR_YAML } from "@/lib/repo-config";

const kvRow = "grid grid-cols-1 gap-x-4 gap-y-0 py-0.5 min-[40rem]:grid-cols-[minmax(0,14ch)_minmax(0,1fr)]";

export function ConfigPane({ yaml, source }: { yaml: string; source: "repo" | "sample" }) {
  return (
    <section aria-label="Review configuration preview" className="py-6 pb-10">
      <h2 className="mb-4 font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
        Review configuration · live preview
      </h2>
      <div className="grid grid-cols-1 items-start gap-4 min-[48rem]:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-border bg-card p-6">
          <h3 className="mb-4 font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
            rextor.yaml — the repo&apos;s knobs
          </h3>
          {source === "sample" && (
            <p className="mb-3 font-mono text-xs text-warning">
              sample knobs — this repo has no rextor.yaml on its default branch (defaults apply)
            </p>
          )}
          <pre className="overflow-x-auto font-mono text-xs leading-[1.7] text-foreground">{yaml}</pre>
          <p className="mt-4 border-t border-border pt-3 font-mono text-xs text-subtle-foreground">
            read from the PR&apos;s base branch — trusted source, never from PR content. Dismissals
            match on (rule_id, path); the line is recorded, not matched.
          </p>
        </div>
        <div className="min-w-0 rounded-lg border border-border bg-card p-6">
          <h3 className="mb-4 font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
            what the PR comment renders
          </h3>
          <div
            className="flex flex-wrap gap-4 whitespace-nowrap rounded border border-rule-strong bg-elevated px-4 py-3 font-mono text-xs tabular-nums"
            role="img"
            aria-label="Score banner sample: risk 100 of 100, 125 findings, 4 in diff, attested"
          >
            <span className="font-medium text-danger">riskScore 100 / 100</span>
            <span>125 findings · 4 in&#8209;diff</span>
            <span className="text-success">status 0 · attested</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Below the banner: the findings table — each row citing exact file:line ranges from the
            diff, ranked by severity. With <code>severity_gate.minimum: high</code> the check-run
            fails on any critical or high finding, blocking merge until resolved or dismissed.
          </p>
          <div className="mt-4 border-t border-border pt-3 font-mono text-xs tabular-nums text-muted-foreground">
            <div className={kvRow}>
              <dt className="text-subtle-foreground">sample</dt>
              <dd className="min-w-0 break-all">
                real receipt — sip-protocol/sip-protocol#1267, head f88a483
              </dd>
            </div>
            <div className={kvRow}>
              <dt className="text-subtle-foreground">attestation</dt>
              <dd className="min-w-0 break-all">
                Tempo testnet · tx 0x13be66d7 · findingsHash pinned to IPFS
              </dd>
            </div>
            <div className={kvRow}>
              <dt className="text-subtle-foreground">comment</dt>
              <dd className="min-w-0 break-all">
                <a
                  className="whitespace-nowrap font-mono text-primary no-underline hover:underline hover:decoration-2 hover:underline-offset-[3px]"
                  href="https://github.com/sip-protocol/sip-protocol/pull/1267#issuecomment-5995895646"
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  the real review ↗
                </a>
              </dd>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export { SAMPLE_REXTOR_YAML };
