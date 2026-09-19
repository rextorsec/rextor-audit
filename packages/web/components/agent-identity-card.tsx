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
  /** Set when the chain read failed — renders the note line. */
  unavailableReason?: string;
}

export function AgentIdentityCard(props: AgentIdentityCardProps) {
  const { name, active, reviewCount, attestedIncomplete, agentAddress, unavailableReason } = props;
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
      </dl>
      {unavailableReason && (
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          chain read unavailable — {unavailableReason}
        </p>
      )}
    </section>
  );
}
