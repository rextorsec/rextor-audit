import type { ReactNode } from "react";

function Artifact({ label, rows }: { label: string; rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="mt-10 border-y border-border py-4 font-mono text-sm tabular-nums">
      <dt className="mb-3 text-xs tracking-[0.12em] uppercase text-subtle-foreground">{label}</dt>
      {rows.map(([term, detail]) => (
        <div
          key={term}
          className="grid grid-cols-1 gap-0 py-1 max-[40rem]:mb-2 min-[40rem]:grid-cols-[minmax(0,14ch)_minmax(0,1fr)] min-[40rem]:gap-4"
        >
          <dt className="text-subtle-foreground">{term}</dt>
          <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

function Stage({
  num,
  id,
  title,
  tight,
  children,
}: {
  num: string;
  id: string;
  title: string;
  tight?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className={`border-t-2 border-rule-strong ${tight ? "py-10" : "py-16"}`}
    >
      <p className="mb-3 font-mono text-sm tracking-[0.14em] text-label">{num}</p>
      <h2 className="mb-4 min-w-0 text-2xl font-bold leading-[1.1] tracking-[-0.02em] [overflow-wrap:anywhere]">
        {title}
      </h2>
      <div className="max-w-[60ch] text-muted-foreground [&>p>strong]:font-medium [&>p>strong]:text-foreground">
        {children}
      </div>
    </div>
  );
}

const receiptLink =
  "font-mono text-sm no-underline whitespace-nowrap text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]";

export function Tour() {
  return (
    <section className="pt-[6rem] pb-[4rem]" id="tour" aria-label="How a review runs">
      <Stage num="1.0" id="s1" title="Scope the diff" tight>
        <p>
          The PR diff becomes a <strong>change-set of functions and callsites</strong> — not a vibe
          read of the whole repo. New external calls, permission changes, and trust‑boundary
          crossings get flagged for the passes below.
        </p>
      </Stage>

      <Stage num="2.0" id="s2" title="Detect deterministically">
        <p>
          <strong>Slither and Aderyn</strong> run in a network‑isolated, read‑only container. Tool
          errors produce an explicit <strong>INCOMPLETE</strong> report — never a fabricated clean
          pass.
        </p>
        <Artifact
          label="analyzer pass · sandboxed"
          rows={[
            [
              "runtime",
              "Slither 0.11.6 + Aderyn, Docker --network none --cap-drop ALL",
            ],
            [
              "scope",
              "diff-scoped: changed functions, new callsites, trust-boundary deltas",
            ],
          ]}
        />
      </Stage>

      <Stage num="3.0" id="s3" title="Triage with citations">
        <p>
          An LLM constrained to <strong>three cited operations</strong>: reclassify a severity,
          dedup into an equal‑or‑higher one, or add a finding — only with a cited line range. It
          assigns <strong>no score</strong>, and any uncited operation is discarded and counted.
        </p>
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
      </Stage>

      <Stage num="4.0" id="s4" title="Prove by execution">
        <p>
          Criticals are <strong>reproduced on a fork</strong> of the target chain — Foundry against
          live state. A finding that survives the fork is <strong>confirmed</strong>; one that
          doesn't is reported as unproven. Reading code is opinion. Running it is evidence.
        </p>
      </Stage>

      <Stage num="5.0" id="s5" title="Anchor the verdict">
        <p>
          The verdict lands <strong>on‑chain</strong>: commit hash, findings hash, risk score, agent
          identity. The score comes from a published rubric — <strong>anyone can recompute it</strong>{" "}
          from the findings alone, then check it against the chain.
        </p>
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
            ["agent", "rextor-audit[bot] · 0xE690…a122 · reviewCount 1"],
            [
              "chain",
              <>
                Tempo testnet 42431 ·{" "}
                <a
                  className={receiptLink}
                  href="https://explore.testnet.tempo.xyz/address/0x7fe69adeaaaf5fb2344ab14ac0eec42463410bcd"
                >
                  verify on the explorer ↗
                </a>
              </>,
            ],
          ]}
        />
      </Stage>
    </section>
  );
}