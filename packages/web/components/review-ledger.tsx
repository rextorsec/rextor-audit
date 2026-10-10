// SPEC-6 §3 — review ledger (approved-mock row anatomy). Untrusted row
// strings render as inert text only. The verify expander carries the SPEC-4
// recipe with the row's REAL inputs; findingsHash stays a recipe + PR-comment
// link (the hash is not in the row schema — never fabricated). When a row's
// chain is not in the web registry, the row's own chain string renders and
// the contract/agent constants are OMITTED — honest omission, never a
// wrong-chain assertion (T10 review carry).
import { shortHex, webChainByName } from "@/lib/chains";
import type { FeedbackReceiptRow, ReviewRow } from "@/lib/reviews";
import { VerifyExpander } from "@/components/verify-expander";

const DANGER_THRESHOLD = 60;

function txLinkTarget(row: Pick<ReviewRow, "chain" | "tx_hash" | "explorer_url">): string | null {
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

/** R2 — a confirmed ERC-8004 feedback broadcast, rendered in the same ledger
 *  list with the same row anatomy. Review-only cells render honest absence
 *  (no head sha, "—" risk score); the badge names the path so a feedback tx is
 *  never mistaken for a review attestation. The tx link derives from the web
 *  chain registry when the row carries no explorer URL (receipts are recorded
 *  with whatever the broadcast outcome carried — often empty). */
function FeedbackLedgerRow({ row }: { row: FeedbackReceiptRow }) {
  const txHref = txLinkTarget(row);
  const date = row.created_at.slice(0, 10);
  return (
    <tr>
      <td data-label="PR">
        <span className="font-mono">#{row.pr}</span>{" "}
        <time className="block font-mono text-xs text-subtle-foreground" dateTime={row.created_at}>
          {date}
        </time>
      </td>
      <td data-label="Risk score" className="font-mono font-medium tabular-nums">
        <span className="font-normal text-subtle-foreground">—</span>
      </td>
      <td data-label="Status">
        <span className="inline-block whitespace-nowrap rounded-full border border-primary px-3 font-mono text-xs text-primary">
          feedback
        </span>
      </td>
      <td data-label="Attestation">
        <p className="font-mono text-xs break-all">
          {row.chain} · {shortHex(row.tx_hash)}
        </p>
        {txHref && (
          <a className={receiptLink} href={txHref} rel="noreferrer noopener" target="_blank">
            tx ↗
          </a>
        )}
      </td>
    </tr>
  );
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
      <td data-label="Status">
        {row.status === 0 ? (
          "complete"
        ) : (
          <span className="inline-block whitespace-nowrap rounded-full border border-warning px-3 font-mono text-xs text-warning">
            INCOMPLETE · status {row.status}
          </span>
        )}
      </td>
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
            <VerifyExpander label="Verify">
              <dl className="border-t border-b border-border py-4 font-mono text-xs tabular-nums">
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
                <div className="mt-0.5 grid grid-cols-1 gap-x-4 gap-y-0 border-t border-dashed border-border pt-2 min-[40rem]:grid-cols-[minmax(0,14ch)_minmax(0,1fr)]">
                  <dt className="text-subtle-foreground">run config</dt>
                  <dd className="min-w-0 break-all">
                    analyzer Slither (offline container) · model{" "}
                    {process.env.NEXT_PUBLIC_TRIAGE_MODEL || "—"} · rextor.yaml from the PR base
                    branch — config digest printed in the comment footer
                  </dd>
                </div>
              </dl>
            </VerifyExpander>
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
        {row.status !== 0 && (
          <VerifyExpander label="Why incomplete">
            <dl className="border-t border-b border-border py-4 font-mono text-xs tabular-nums">
              <div className="grid grid-cols-1 gap-x-4 gap-y-0 py-0.5 min-[40rem]:grid-cols-[minmax(0,14ch)_minmax(0,1fr)]">
                <dt className="text-subtle-foreground">reason</dt>
                <dd className="min-w-0 break-all">
                  infrastructure-era failure — the root cause lives in the service run log for this
                  head, not in the comment body, and is not re-attributed here. INCOMPLETE is never
                  silent: it attests with status {row.status} and score 0.
                </dd>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-0 py-0.5 min-[40rem]:grid-cols-[minmax(0,14ch)_minmax(0,1fr)]">
                <dt className="text-subtle-foreground">re-run</dt>
                <dd className="min-w-0 break-all">
                  head shas are deduped by (repo, pr, headSha) — a settled INCOMPLETE re-fires on a
                  new head.
                </dd>
              </div>
            </dl>
          </VerifyExpander>
        )}
      </td>
    </tr>
  );
}

export function ReviewLedger({
  rows,
  feedbackReceipts,
  repoFullName,
  agentName,
}: {
  rows: ReviewRow[];
  /** R2 — confirmed feedback broadcasts; an empty list adds no rows (the
   *  ledger renders exactly as it did before receipts existed). */
  feedbackReceipts: FeedbackReceiptRow[];
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
          {feedbackReceipts.map((row) => (
            <FeedbackLedgerRow key={`${row.pr}-${row.tx_hash}-${row.created_at}`} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
