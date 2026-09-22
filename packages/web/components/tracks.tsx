import { WEB_CHAINS } from "@/lib/chains";
import { receiptLink } from "@/lib/receipt-link";

const trackRow =
  "grid grid-cols-1 gap-6 border-t border-border py-6 items-baseline min-[60rem]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]";

/** `totalReviews` binds the same live-read total the hero facts strip renders
 *  (last-verified fallback when RPC is down) — never a hard-coded count. */
export function Tracks({ totalReviews }: { totalReviews: number }) {
  return (
    <section className="pb-16 pt-10" id="tracks" aria-label="Track board">
      <h2 className="mb-10 text-2xl font-semibold leading-[1.15] tracking-[-0.02em] [overflow-wrap:anywhere]">
        Where it runs
      </h2>

      <div className={trackRow}>
        <p className="m-0 text-md font-semibold tracking-[-0.01em]">
          Tempo{" "}
          <small className="ml-3 font-mono text-xs font-normal text-subtle-foreground">
            flagship · chainId {WEB_CHAINS.tempo.chainId}
          </small>
        </p>
        <p className="m-0 text-sm text-muted-foreground">
          <strong className="font-semibold text-foreground">Full loop, live.</strong> Slither,
          fork‑sim, attestation v2 deploy #3 — {totalReviews} reviews anchored —{" "}
          <a
            className={receiptLink}
            href={`${WEB_CHAINS.tempo.explorer}/address/${WEB_CHAINS.tempo.attestation}`}
          >
            contract ↗
          </a>
        </p>
      </div>

      <div className={trackRow}>
        <p className="m-0 text-md font-semibold tracking-[-0.01em]">
          HyperEVM{" "}
          <small className="ml-3 font-mono text-xs font-normal text-subtle-foreground">
            primary · chainId {WEB_CHAINS.hyperliquid.chainId}
          </small>
        </p>
        <p className="m-0 text-sm text-muted-foreground">
          <strong className="font-semibold text-foreground">Mainnet, live.</strong> Attestation v2
          deployed 2026‑09‑21, agent registered active — first mainnet attestations pending —{" "}
          <a
            className={receiptLink}
            href={`${WEB_CHAINS.hyperliquid.explorer}/address/${WEB_CHAINS.hyperliquid.attestation}`}
          >
            contract ↗
          </a>
        </p>
      </div>

      <div className={trackRow}>
        <p className="m-0 text-md font-semibold tracking-[-0.01em]">
          Riders{" "}
          <small className="ml-3 font-mono text-xs font-normal text-subtle-foreground">
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
