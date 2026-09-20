const receiptLink =
  "font-mono text-sm no-underline whitespace-nowrap text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]";

const trackRow =
  "grid grid-cols-1 gap-1 border-t border-border py-6 items-baseline min-[40rem]:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] min-[40rem]:gap-6";

export function Tracks() {
  return (
    <section className="py-16" id="tracks" aria-label="Track board">
      <h2 className="mb-10 text-2xl font-bold tracking-[-0.02em] [overflow-wrap:anywhere]">
        Where it runs
      </h2>

      <div className={trackRow}>
        <p className="font-mono text-sm tabular-nums">
          Tempo <small className="block text-xs text-subtle-foreground">flagship · chainId 42431</small>
        </p>
        <p className="text-muted-foreground">
          <strong className="font-medium text-foreground">Full loop, live.</strong> Slither + Aderyn,
          fork‑sim, attestation deployed 2026‑09‑18 —{" "}
          <a
            className={receiptLink}
            href="https://explore.testnet.tempo.xyz/address/0x51ac8214089daf85b188437b087519acfc6c495a"
          >
            contract ↗
          </a>
        </p>
      </div>

      <div className={trackRow}>
        <p className="font-mono text-sm tabular-nums">
          HyperEVM <small className="block text-xs text-subtle-foreground">primary · chainId 998</small>
        </p>
        <p className="text-muted-foreground">
          <strong className="font-medium text-foreground">Deploy #2 pending</strong> — same loop,
          attestation v2 deploys directly.
        </p>
      </div>

      <div className={trackRow}>
        <p className="font-mono text-sm tabular-nums">
          Riders <small className="block text-xs text-subtle-foreground">config‑level</small>
        </p>
        <p className="text-muted-foreground">
          <strong className="font-medium text-foreground">
            Ethereum 1 · Base 8453 · Arbitrum 42161 · Robinhood Chain
          </strong>{" "}
          — deterministic pass; verdicts anchor home‑chain with a target‑chain field. No per‑rider
          code paths.
        </p>
      </div>
    </section>
  );
}