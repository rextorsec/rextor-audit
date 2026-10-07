// SPEC-6 §3 (dashboard v2, approved mock) — agent identity card. Live
// agents() reads per attestation chain; every failure degrades to honest
// "—" fields + a note, never guesses.
import { shortHex } from "@/lib/chains";

export interface AgentIdentityCardProps {
  /** From the live agents() read on the active chain; null → "—". */
  name: string | null;
  /** null → no status pill (read unavailable). */
  active: boolean | null;
  /** Per-chain on-chain reviewCount — the v2 mock's attested tiles. */
  attestedPerChain: Array<{ chain: string; count: number | null }>;
  /** Attested reviews with status=1 among this repo's ledger rows. */
  attestedIncomplete: number;
  agentAddress: string;
  /** C1 — canonical ERC-8004 identity; absent → no citation row. */
  erc8004?: {
    agentRegistry: string;
    agentId: number;
    tx: string;
  };
  /** Set when the chain read failed — renders the note line. */
  unavailableReason?: string;
}

export function AgentIdentityCard(props: AgentIdentityCardProps) {
  const { name, active, attestedPerChain, attestedIncomplete, agentAddress, erc8004, unavailableReason } = props;
  const cell = "mt-1 break-all";
  const label = "text-subtle-foreground tracking-[0.1em] uppercase";
  return (
    <section
      aria-label="Agent identity"
      className="border-border rounded-lg border p-6 my-6 mx-0"
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h2 className="text-md font-bold tracking-[-0.01em] break-all">
          {name ?? "—"}{" "}
          {active !== null && (
            <span
              className={`font-mono text-xs font-normal tracking-[0.08em] ml-1 ${
                active ? "text-success" : "text-danger"
              }`}
            >
              {active ? "ACTIVE" : "INACTIVE"}
            </span>
          )}
        </h2>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-4 min-[30rem]:grid-cols-2 min-[48rem]:grid-cols-4 font-mono text-xs tabular-nums">
        <div>
          <dt className={label}>Agent address</dt>
          <dd className={cell} title={agentAddress}>
            {shortHex(agentAddress)}
          </dd>
        </div>
        {attestedPerChain.map(({ chain, count }) => (
          <div key={chain}>
            <dt className={label}>{chain} attested</dt>
            <dd className={cell}>{count === null ? "—" : count}</dd>
          </div>
        ))}
        <div>
          <dt className={label}>Attested incomplete</dt>
          <dd className={cell}>{attestedIncomplete}</dd>
        </div>
        {erc8004 && (
          <div>
            <dt className={label}>ERC-8004 identity</dt>
            <dd className={cell}>
              <a
                className="text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]"
                title={erc8004.agentRegistry}
                href={`https://etherscan.io/tx/${erc8004.tx}`}
              >
                #{erc8004.agentId} · {erc8004.agentRegistry.split(":").slice(0, 2).join(":")}
              </a>
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-4 font-mono text-xs text-subtle-foreground">
        agents() + reviewCount read live from the attestation contracts via public RPC — browser
        holds no keys.
      </p>
      {unavailableReason && (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          chain read unavailable — {unavailableReason}
        </p>
      )}
    </section>
  );
}
