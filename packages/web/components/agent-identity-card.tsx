// SPEC-6 §3 — agent identity card (approved-mock anatomy). Live agents()
// read; every failure degrades to honest "—" fields + a note, never guesses.
import { shortHex } from "@/lib/chains";

export interface AgentIdentityCardProps {
  /** From the live agents() read; null → "—". */
  name: string | null;
  /** null → no status pill (read unavailable). */
  active: boolean | null;
  /** On-chain agent reviewCount; null → "—". */
  reviewCount: number | null;
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
  const { name, active, reviewCount, attestedIncomplete, agentAddress, erc8004, unavailableReason } = props;
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
      <dl className="mt-4 grid grid-cols-1 gap-4 min-[40rem]:grid-cols-3 font-mono text-xs tabular-nums">
        <div>
          <dt className="text-subtle-foreground tracking-[0.1em] uppercase">Agent address</dt>
          <dd className="mt-1 break-all" title={agentAddress}>
            {shortHex(agentAddress)}
          </dd>
        </div>
        <div>
          <dt className="text-subtle-foreground tracking-[0.1em] uppercase">Attested reviews</dt>
          <dd className="mt-1">{reviewCount === null ? "—" : reviewCount}</dd>
        </div>
        <div>
          <dt className="text-subtle-foreground tracking-[0.1em] uppercase">Attested incomplete</dt>
          <dd className="mt-1">{attestedIncomplete}</dd>
        </div>
        {erc8004 && (
          <div>
            <dt className="text-subtle-foreground tracking-[0.1em] uppercase">ERC-8004 identity</dt>
            <dd className="mt-1 break-all">
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
      {unavailableReason && (
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          chain read unavailable — {unavailableReason}
        </p>
      )}
    </section>
  );
}
