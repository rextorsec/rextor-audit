import type { ReactNode } from "react";

import { HeroSpotlight } from "@/components/hero-spotlight";
import { Button } from "@/components/ui/button";
import type { AgentIdentity } from "@/lib/chain-read";
import { WEB_CHAINS, shortHex } from "@/lib/chains";
import { receiptLink } from "@/lib/receipt-link";

/**
 * Honest fallbacks — last on-chain verified counts (2026-09-22). Used only
 * when the public RPC read fails; the page revalidates every 5 minutes.
 * Exported for the page composition (Tracks binds the same total).
 */
export const FALLBACK_COUNTS = { tempo: 5, hyperliquid: 0 } as const;

export interface HeroProps {
  /** Live agent-identity reads per chain (null → honest fallback counts). */
  tempo: AgentIdentity | null;
  hyperliquid: AgentIdentity | null;
}

/** Facts strip row — mono, tabular, single-line. */
function Fact({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>;
}

export function Hero({ tempo, hyperliquid }: HeroProps) {
  const totalReviews =
    (tempo?.reviewCount ?? FALLBACK_COUNTS.tempo) +
    (hyperliquid?.reviewCount ?? FALLBACK_COUNTS.hyperliquid);
  const agentActive = tempo?.active ?? true;

  return (
    <header className="container relative isolate pt-[clamp(2.5rem,5vw,3.5rem)] pb-[clamp(4.5rem,9vw,6rem)]">
      <HeroSpotlight />
      <div className="dot-canvas pointer-events-none absolute inset-0 -z-[1]" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="grid items-center gap-16 min-[60rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div>
          <p className="mb-4 font-mono text-xs tracking-[0.14em] uppercase text-subtle-foreground">
            PR-time smart-contract auditing
          </p>
          <h1 className="title-unmask m-0 min-w-0 text-[clamp(2.5rem,4vw+0.75rem,4rem)] leading-[1.04] font-semibold tracking-[-0.03em] [overflow-wrap:anywhere]">
            <span>Audits are point&#8209;in&#8209;time.</span>
            <br />
            <span>Code is continuous.</span>
          </h1>
          <p className="mx-0 mt-10 mb-6 max-w-[45ch] text-md leading-[1.55] text-muted-foreground">
            Every pull request that touches money&#8209;code becomes an audit event. Generic
            reviewers read code changes — Rextor audits money changes, and anchors the verdict
            on&#8209;chain.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Button asChild>
              <a href="#install">Install the GitHub App</a>
            </Button>
            <a
              className={receiptLink}
              href={`${WEB_CHAINS.tempo.explorer}/address/${WEB_CHAINS.tempo.attestation}`}
            >
              See a live verdict ↗
            </a>
          </div>
        </div>
        <figure className="m-0 w-full justify-self-end min-[60rem]:w-[calc(100%+6vw)] min-[60rem]:mr-[-6vw]">
          <div className="rounded-lg border border-border bg-card px-6 py-4 font-mono tabular-nums">
            <p className="m-0 mb-0.5 flex items-center justify-between text-sm font-medium leading-[1.2]">
              <span className="inline-flex items-center gap-3">
                <i className="inline-block size-1.5 rounded-full bg-primary" aria-hidden="true" />
                rextor-audit[bot]
              </span>
              <span className="tracking-[0.06em] text-primary">PASS ✓</span>
            </p>
            <p className="m-0 mb-4 text-xs text-subtle-foreground">
              check run · diff-scoped · fork-proven
            </p>
            <div className="grid gap-1 border-y border-border py-3">
              {(
                [
                  ["bg-danger", "critical", "0", "×60"],
                  ["bg-warning", "high", "0", "×25"],
                  ["bg-muted-foreground", "medium", "1", "×10"],
                  ["bg-rule-strong", "low", "2", "×3"],
                ] as const
              ).map(([dot, label, count, weight]) => (
                <p
                  key={label}
                  className="m-0 flex items-center gap-3 text-xs leading-[1.4] text-muted-foreground"
                >
                  <i className={`inline-block size-1.5 rounded-full ${dot}`} aria-hidden="true" />
                  {label}
                  <em className="ml-auto not-italic text-foreground">{count}</em>
                  <small className="text-subtle-foreground">{weight}</small>
                </p>
              ))}
            </div>
            <p className="m-0 flex items-baseline gap-3 py-3 text-xs text-subtle-foreground">
              <span>risk score</span>
              <b className="text-md leading-none font-semibold text-primary">16</b>
              <small className="ml-auto text-subtle-foreground">/100 · 1×10 + 2×3</small>
            </p>
            <dl className="m-0 grid gap-1 border-t border-border pt-3">
              {(
                [
                  ["reviewId", "keccak256(rextor/review/v1|…)"],
                  ["agent", `${shortHex(WEB_CHAINS.tempo.agent)} · rextor-audit[bot]`],
                  [
                    "chains",
                    `Tempo ${WEB_CHAINS.tempo.chainId} · HyperEVM ${WEB_CHAINS.hyperliquid.chainId}`,
                  ],
                ] as const
              ).map(([term, value]) => (
                <div
                  key={term}
                  className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] gap-3 text-xs"
                >
                  <dt className="text-subtle-foreground">{term}</dt>
                  <dd className="m-0 truncate text-muted-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <figcaption className="m-0 mt-3 font-mono text-xs text-subtle-foreground">
            Exhibit 01 — sample verdict. The score recomputes from the findings: 1×10 + 2×3 = 16.
          </figcaption>
        </figure>
      </div>
      <div
        className="mt-16 flex flex-wrap gap-x-16 gap-y-3 border-t border-border pt-4 font-mono text-xs tabular-nums text-subtle-foreground"
        title={
          tempo !== null && hyperliquid !== null
            ? undefined
            : "Counts are the last on-chain verified values (2026-09-22) — live RPC read unavailable"
        }
      >
        <Fact>Tempo testnet · chainId {WEB_CHAINS.tempo.chainId}</Fact>
        <Fact>Attestation v2 · deploy #3 · {shortHex(WEB_CHAINS.tempo.attestation)}</Fact>
        <Fact>
          HyperEVM mainnet · {WEB_CHAINS.hyperliquid.chainId} ·{" "}
          {shortHex(WEB_CHAINS.hyperliquid.attestation)}
        </Fact>
        <Fact>Agent rextor-audit[bot] · {agentActive ? "active" : "inactive"}</Fact>
        <Fact>Attested reviews · {totalReviews}</Fact>
      </div>
    </header>
  );
}
