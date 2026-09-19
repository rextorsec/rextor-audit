// SPEC-6 §3 — review ledger (approved-mock row anatomy). Untrusted row
// strings render as inert text only. The verify expander carries the SPEC-4
// recipe with the row's REAL inputs; findingsHash stays a recipe + PR-comment
// link (the hash is not in the row schema — never fabricated). When a row's
// chain is not in the web registry, the row's own chain string renders and
// the contract/agent constants are OMITTED — honest omission, never a
// wrong-chain assertion (T10 review carry).
import { shortHex, webChainByName } from "@/lib/chains";
import type { ReviewRow } from "@/lib/reviews";

const DANGER_THRESHOLD = 60;

function txLinkTarget(row: ReviewRow): string | null {
  if (row.explorer_url) return row.explorer_url;
  if (!row.tx_hash) return null;
  const chain = webChainByName(row.chain);
  return chain ? `${chain.explorer}/tx/${row.tx_hash}` : null;
}

const receiptLink =
  "font-mono text-sm whitespace-nowrap text-primary no-underline hover:underline hover:decoration-2 hover:underline-offset-[3px]";

export interface ReviewLedgerRowProps {
  row: ReviewRow;
  /** Canonical "owner/repo" — feeds the reviewId recipe. */
  repoFullName: string;
  /** Live on-chain agent name (identity read); falls back to the registry. */
  agentName: string | null;
}

export function ReviewLedgerRow({ row, repoFullName, agentName }: ReviewLedgerRowProps) {
  const txHref = txLinkTarget(row);
  const attested = row.tx_hash.length > 0;
  const chain = row.chain ? webChainByName(row.chain) : undefined;
  const date = row.created_at.slice(0, 10);

  return (
    <tr>
      <td data-label="PR">
        <span className="font-mono">#{row.pr}</span>{" "}
        <span className="font-mono text-muted-foreground">
          {row.head_sha.slice(0, 7)}
        </span>
        <time className="block font-mono text-xs text-subtle-foreground" dateTime={row.created_at}>
          {date}
        </time>
      </td>
      <td data-label="Risk score" className="font-mono font-medium tabular-nums">
        <span
          aria-hidden="true"
          className={`mr-1 inline-block size-2 rounded-[1px] ${
            row.risk_score >= DANGER_THRESHOLD ? "bg-danger" : "bg-warning"
          }`}
        />
        {row.risk_score} <span className="font-normal text-subtle-foreground">/ 100</span>
      </td>
      <td data-label="Status">{row.status === 0 ? "complete" : "incomplete"}</td>
      <td data-label="Attestation">
        {attested ? (
          <>
            <p className="font-mono text-xs break-all">
              {row.chain} · {shortHex(row.tx_hash)}
            </p>
            {txHref && (
              <a className={receiptLink} href={txHref} rel="noreferrer noopener" target="_blank">
                tx ↗
              </a>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground">
                Verify
              </summary>
              <dl className="mt-2 border-t border-b border-border py-4 font-mono text-xs tabular-nums">
                <div className="grid grid-cols-1 gap-x-4 gap-y-0 py-0.5 min-[40rem]:grid-cols-[minmax(0,14ch)_minmax(0,1fr)]">
                  <dt className="text-subtle-foreground">reviewId</dt>
                  <dd className="min-w-0 break-all">
                    keccak256("rextor/review/v1|{repoFullName}|{row.pr}|{row.head_sha}")
                    <span className="block text-muted-foreground">→ {row.review_id}</span>
                  </dd>
                </div>
                <div className="grid grid-cols-1 gap-x-4 gap-y-0 py-0.5 min-[40rem]:grid-cols-[minmax(0,14ch)_minmax(0,1fr)]">
                  <dt className="text-subtle-foreground">findingsHash</dt>
                  <dd className="min-w-0 break-all">
                    sha256 of the canonical findings JSON — printed in the PR comment; recompute it
                    there and compare on-chain via verify()
                    {row.comment_url && (
                      <>
                        {" "}
                        <a
                          className="text-primary hover:underline"
                          href={row.comment_url}
                          rel="noreferrer noopener"
                          target="_blank"
                        >
                          PR comment ↗
                        </a>
                      </>
                    )}
                  </dd>
                </div>
                {chain && (
                  <>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-0 py-0.5 min-[40rem]:grid-cols-[minmax(0,14ch)_minmax(0,1fr)]">
                      <dt className="text-subtle-foreground">chain</dt>
                      <dd className="min-w-0 break-all">
                        {chain.name} {chain.chainId} · contract {shortHex(chain.attestation)}
                      </dd>
                    </div>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-0 py-0.5 min-[40rem]:grid-cols-[minmax(0,14ch)_minmax(0,1fr)]">
                      <dt className="text-subtle-foreground">agent</dt>
                      <dd className="min-w-0 break-all">
                        {agentName ?? "rextor-audit[bot]"} · {shortHex(chain.agent)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </details>
          </>
        ) : (
          <>
            <p className="font-mono text-xs break-all">none — not attested</p>
            {row.comment_url && (
              <a
                className={receiptLink}
                href={row.comment_url}
                rel="noreferrer noopener"
                target="_blank"
              >
                PR comment ↗
              </a>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

export function ReviewLedger({
  rows,
  repoFullName,
  agentName,
}: {
  rows: ReviewRow[];
  repoFullName: string;
  agentName: string | null;
}) {
  return (
    <section aria-label="Review ledger" className="block py-6 pb-10">
      <h2 className="mb-4 font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
        Review ledger
      </h2>
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr>
            <th
              scope="col"
              className="border-b border-rule-strong px-0 pt-1 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
            >
              PR
            </th>
            <th
              scope="col"
              className="border-b border-rule-strong px-0 pt-1 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
            >
              Risk score
            </th>
            <th
              scope="col"
              className="border-b border-rule-strong px-0 pt-1 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
            >
              Status
            </th>
            <th
              scope="col"
              className="border-b border-rule-strong px-0 pt-1 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
            >
              Attestation
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ReviewLedgerRow key={`${row.pr}-${row.head_sha}-${row.created_at}`} row={row} repoFullName={repoFullName} agentName={agentName} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
