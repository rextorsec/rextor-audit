import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <header className="container pt-[9rem] pb-[6rem]">
      <div className="grid items-start gap-8 min-[60rem]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] min-[60rem]:items-end">
        <div>
          <p className="mb-4 font-mono text-xs tracking-[0.14em] uppercase text-label">
            PR-time smart-contract auditing
          </p>
          <h1 className="min-w-0 text-display font-bold leading-[1.05] tracking-[-0.03em] [overflow-wrap:anywhere] [text-wrap:balance]">
            Audits are point‑in‑time.
            <br />
            Code is continuous.
          </h1>
        </div>
        <div>
          <p className="mb-6 max-w-[38ch] text-md text-muted-foreground">
            Every pull request that touches money‑code becomes an audit event. Generic reviewers
            read code changes — Rextor audits money changes, and anchors the verdict on‑chain.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Button asChild>
              <a href="#install">Install the GitHub App</a>
            </Button>
            <a
              className="font-mono text-sm no-underline whitespace-nowrap text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]"
              href="https://explore.testnet.tempo.xyz/address/0x51ac8214089daf85b188437b087519acfc6c495a"
            >
              See a live verdict ↗
            </a>
          </div>
        </div>
      </div>
      <div className="mt-10 flex flex-wrap gap-6 border-t border-border pt-4 font-mono text-xs tabular-nums text-subtle-foreground">
        <span>Live on Tempo testnet · chainId 42431</span>
        <span>Contract 0x7fe6…0bcd</span>
        <span>Agent rextor-audit[bot] · active</span>
        <span>Attested reviews: 1</span>
      </div>
    </header>
  );
}