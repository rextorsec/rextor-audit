import type { ReactNode } from "react";

const receiptLink =
  "font-mono text-sm no-underline whitespace-nowrap text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]";

function Artifact({ label, rows }: { label: string; rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="m-0 rounded-lg border border-border bg-card px-6 py-4">
      <dt className="mb-2 font-mono text-xs tracking-[0.1em] uppercase text-subtle-foreground">
        {label}
      </dt>
      {rows.map(([term, detail]) => (
        <div
          key={term}
          className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] gap-3 py-0.5 font-mono text-xs leading-[1.55] tabular-nums"
        >
          <dt className="text-subtle-foreground">{term}</dt>
          <dd className="m-0 text-muted-foreground [&>a]:font-mono [&>a]:text-xs">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

function Stage({
  num,
  id,
  title,
  children,
  artifact,
}: {
  num: string;
  id: string;
  title: string;
  children: ReactNode;
  artifact?: ReactNode;
}) {
  return (
    <div
      id={id}
      className="grid items-start gap-16 border-t border-border py-10 min-[60rem]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
    >
      <div>
        <p className="m-0 mb-2 font-mono text-xs tracking-[0.1em] tabular-nums text-subtle-foreground">
          {num}
        </p>
        <h2 className="mb-2 min-w-0 text-lg leading-[1.25] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">
          {title}
        </h2>
        <div className="m-0 max-w-[62ch] text-muted-foreground [&>p>strong]:font-medium [&>p>strong]:text-foreground">
          {children}
        </div>
      </div>
      {artifact}
    </div>
  );
}

export function Tour() {
  return (
    <section className="pb-16 pt-10" id="tour" aria-label="How a review runs">
      <h2 className="mb-10 text-2xl font-semibold leading-[1.15] tracking-[-0.02em] [overflow-wrap:anywhere]">
        How a review runs
      </h2>

      <Stage num="1.0" id="s1" title="Scope the diff">
        <p>
          The PR diff becomes a <strong>change-set of functions and callsites</strong> — not a vibe
          read of the whole repo. New external calls, permission changes, and trust‑boundary
          crossings get flagged for the passes below.
        </p>
      </Stage>

      <Stage
        num="2.0"
        id="s2"
        title="Detect deterministically"
        artifact={
          <Artifact
            label="analyzer pass · sandboxed"
            rows={[
              ["runtime", "Slither 0.11.6 + Aderyn, Docker --network none --cap-drop ALL"],
              ["scope", "diff-scoped: changed functions, new callsites, trust-boundary deltas"],
            ]}
          />
        }
      >
        <p>
          <strong>Slither and Aderyn</strong> run in a network‑isolated, read‑only container. Tool
          errors produce an explicit <strong>INCOMPLETE</strong> report — never a fabricated clean
          pass.
        </p>
      </Stage>

      <Stage
        num="3.0"
        id="s3"
        title="Triage with citations"
        artifact={
          <Artifact
            label="triage policy · temperature 0"
            rows={[
              [
                "allowed",
                "reclassify (original preserved) · dedup (never escalates) · add (cited lines only)",
              ],
              ["forbidden", "scoring · inventing findings · operating without a citation"],
            ]}
          />
        }
      >
        <p>
          An LLM constrained to <strong>three cited operations</strong>: reclassify a severity,
          dedup into an equal‑or‑higher one, or add a finding — only with a cited line range. It
          assigns <strong>no score</strong>, and any uncited operation is discarded and counted.
        </p>
      </Stage>

      <Stage num="4.0" id="s4" title="Prove by execution">
        <p>
          Criticals are <strong>reproduced on a fork</strong> of the target chain — Foundry against
          live state. A finding that survives the fork is <strong>confirmed</strong>; one that
          doesn&apos;t is reported as unproven. Reading code is opinion. Running it is evidence.
        </p>
      </Stage>

      <Stage
        num="5.0"
        id="s5"
        title="Anchor the verdict"
        artifact={
          <Artifact
            label="attestation · real record"
            rows={[
              [
                "reviewId",
                'keccak256("rextor/review/v1|" + owner/repo + "|" + pr + "|" + headSha)',
              ],
              [
                "findingsHash",
                "sha256 of the canonical findings JSON — printed in every review comment",
              ],
              ["score", "rubric: critical 60 · high 25 · medium 10 · low 3, cap 100"],
              ["agent", "rextor-audit[bot] · 0x5f2b…47f37"],
              [
                "chains",
                <>
                  <a
                    className={receiptLink}
                    href="https://explore.testnet.tempo.xyz/address/0x51ac8214089daf85b188437b087519acfc6c495a"
                  >
                    Tempo 42431 ↗
                  </a>{" "}
                  ·{" "}
                  <a
                    className={receiptLink}
                    href="https://hyperevmscan.io/address/0x8f63c0581ab3b2836c95f97fcf104d2dd962850c"
                  >
                    HyperEVM 999 ↗
                  </a>
                </>,
              ],
            ]}
          />
        }
      >
        <p>
          The verdict lands <strong>on‑chain</strong>: commit hash, findings hash, risk score, agent
          identity. The score comes from a published rubric — <strong>anyone can recompute it</strong>{" "}
          from the findings alone, then check it against the chain.
        </p>
      </Stage>
    </section>
  );
}
