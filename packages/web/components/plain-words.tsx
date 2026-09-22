/** "Rextor, in plain words" — 3-step dual-register strip (noob sentence + mono tech term). */
const steps = [
  {
    num: "Step 01",
    line: "Install the app. It joins your repo like a reviewer.",
    tech: "GitHub App · two-click install",
  },
  {
    num: "Step 02",
    line: "Every PR that touches money-code gets audited — machines find, citations prove, forks test.",
    tech: "diff-scoped · Slither + Aderyn · Foundry fork-sim",
  },
  {
    num: "Step 03",
    line: "The verdict lands on-chain — permanent, checkable by anyone, impossible to quietly edit.",
    tech: "attestation · Tempo testnet + HyperEVM mainnet",
  },
];

export function PlainWords() {
  return (
    <section className="pb-16 pt-10" id="plain" aria-label="Rextor in plain words">
      <h2 className="mb-10 text-2xl font-semibold leading-[1.15] tracking-[-0.02em] [overflow-wrap:anywhere]">
        Rextor, in plain words
      </h2>
      <div className="grid gap-10 min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
        {steps.map(({ num, line, tech }) => (
          <div key={num} className="min-w-0 border-t border-border pt-4">
            <p className="m-0 mb-2 font-mono text-xs tracking-[0.1em] tabular-nums text-subtle-foreground">
              {num}
            </p>
            <p className="m-0 mb-2 text-md leading-[1.45] font-medium tracking-[-0.01em]">{line}</p>
            <p className="m-0 font-mono text-xs text-subtle-foreground">{tech}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
