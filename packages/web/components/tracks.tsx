const receiptLink =
  "font-mono text-sm no-underline whitespace-nowrap text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]";

const trackRow =
  "grid grid-cols-1 gap-2 border-t border-border py-6 items-baseline min-[60rem]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] min-[60rem]:gap-6";

export function Tracks() {
  return (
    <section className="pb-16 pt-10" id="tracks" aria-label="Track board">
      <h2 className="mb-10 text-2xl font-semibold leading-[1.15] tracking-[-0.02em] [overflow-wrap:anywhere]">
        Where it runs
      </h2>

      <div className={trackRow}>
        <p className="m-0 font-mono text-md tabular-nums">
          Tempo{" "}
          <small className="ml-2 font-mono text-xs font-normal text-subtle-foreground">
            flagship · chainId 42431
          </small>
        </p>
        <p className="m-0 text-sm text-muted-foreground">
          <strong className="font-semibold text-foreground">Full loop, live.</strong> Slither +
          Aderyn, fork‑sim, attestation v3 — 5 reviews anchored —{" "}
          <a
            className={receiptLink}
            href="https://explore.testnet.tempo.xyz/address/0x51ac8214089daf85b188437b087519acfc6c495a"
          >
            contract ↗
          </a>
        </p>
      </div>

      <div className={trackRow}>
        <p className="m-0 font-mono text-md tabular-nums">
          HyperEVM{" "}
          <small className="ml-2 font-mono text-xs font-normal text-subtle-foreground">
            primary · chainId 999
          </small>
        </p>
        <p className="m-0 text-sm text-muted-foreground">
          <strong className="font-semibold text-foreground">Mainnet, live.</strong> Attestation v2
          deployed 2026‑09‑21, agent registered active — first mainnet attestations pending —{" "}
          <a
            className={receiptLink}
            href="https://hyperevmscan.io/address/0x8f63c0581ab3b2836c95f97fcf104d2dd962850c"
          >
            contract ↗
          </a>
        </p>
      </div>

      <div className={trackRow}>
        <p className="m-0 font-mono text-md tabular-nums">
          Riders{" "}
          <small className="ml-2 font-mono text-xs font-normal text-subtle-foreground">
            config‑level
          </small>
        </p>
        <p className="m-0 text-sm text-muted-foreground">
          <strong className="font-semibold text-foreground">
            Ethereum 1 · Base 8453 · Arbitrum 42161 · Robinhood Chain
          </strong>{" "}
          — deterministic pass; verdicts anchor home‑chain with a target‑chain field. No per‑rider
          code paths.
        </p>
      </div>
    </section>
  );
}
