// SPEC-6 §3 — deep-scan ledger (approved-mock row anatomy, mockups/deep-scan).
// Untrusted row strings render as inert text only (React escaping — never
// dangerouslySetInnerHTML). Zero-meaningful display: risk null renders "—"
// (never 0); a completed clean pass renders a real "0" findings; an
// INCOMPLETE row keeps its row with risk and findings at "—"; a run recorded
// without a head renders "—". Status mirrors the on-chain encoding: 0
// complete, 1 INCOMPLETE. The ledger row carries no cause/degradation fields,
// so those chips render only in the report view — honest omission here, never
// a fabricated cause.
import type { ScanRow } from "@/lib/scans";

// Family risk-band boundary (review-ledger / score-history): below 60 reads
// low (success swatch), at/above 60 reads elevated (warning swatch). The
// approved mock's two ledger swatches — 34 → success, 67 → warning — sit on
// the same boundary, and the mock defines no third band for the ledger.
const LOW_RISK_BELOW = 60;

export function ScansLedgerRow({ row }: { row: ScanRow }) {
  const complete = row.status === 0;
  return (
    <tr>
      <td
        data-label="Repo"
        className="px-0 py-4 pr-4 align-top font-mono break-all border-b border-border"
      >
        {row.repo}
      </td>
      <td
        data-label="Ref"
        className="px-0 py-4 pr-4 align-top font-mono text-xs whitespace-nowrap text-muted-foreground border-b border-border"
      >
        {row.ref}
      </td>
      <td
        data-label="Head"
        title={row.head_sha || undefined}
        className="px-0 py-4 pr-4 align-top font-mono break-all border-b border-border"
      >
        {row.head_sha ? row.head_sha.slice(0, 7) : "—"}
      </td>
      <td data-label="Status" className="px-0 py-4 pr-4 align-top border-b border-border">
        {complete ? (
          <span className="inline-block whitespace-nowrap rounded-full border border-primary px-3 font-mono text-xs text-primary">
            complete · status 0
          </span>
        ) : (
          <span className="inline-block whitespace-nowrap rounded-full border border-warning px-3 font-mono text-xs text-warning">
            INCOMPLETE · status {row.status}
          </span>
        )}
      </td>
      <td
        data-label="Risk"
        className="px-0 py-4 pr-4 align-top font-mono font-medium tabular-nums border-b border-border"
      >
        {row.risk_score === null ? (
          "—"
        ) : (
          <>
            <span
              aria-hidden="true"
              className={`mr-1 inline-block size-2 rounded-[1px] ${
                row.risk_score < LOW_RISK_BELOW ? "bg-success" : "bg-warning"
              }`}
            />
            {row.risk_score} <span className="font-normal text-subtle-foreground">/ 100</span>
          </>
        )}
      </td>
      <td
        data-label="Findings"
        className="px-0 py-4 pr-4 align-top font-mono font-medium tabular-nums border-b border-border"
      >
        {complete ? row.finding_count : "—"}
      </td>
      <td
        data-label="Scanned (UTC)"
        className="px-0 py-4 pr-4 align-top font-mono text-xs whitespace-nowrap text-muted-foreground border-b border-border"
      >
        {/* As delivered: the ISO instant's T swapped for a space — never
            re-zoned by the browser. */}
        <time dateTime={row.created_at}>
          {row.created_at.replace("T", " ").slice(0, 19)}
        </time>
      </td>
    </tr>
  );
}

export function ScansLedger({ rows }: { rows: ScanRow[] }) {
  return (
    <section aria-label="Deep Scan ledger" className="block py-6 pb-10">
      <h2 className="mb-4 font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
        Scan ledger · newest first
      </h2>
      {rows.length === 0 ? (
        <section
          aria-label="No scans yet"
          className="my-10 rounded-lg border border-dashed border-rule-strong p-10 text-center"
        >
          <span className="mb-2 block font-mono text-xs tracking-[0.12em] uppercase text-label">
            empty ledger · shown when a repo has no scans
          </span>
          <p className="mx-auto max-w-[46ch] text-muted-foreground">
            No scans yet — run the first Deep Scan.
          </p>
          <p className="mx-auto max-w-[46ch] text-muted-foreground">
            The first run writes row one: repo, ref, head, status, risk, findings, scanned — newest
            first.
          </p>
        </section>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] border-collapse text-sm tabular-nums">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-b border-rule-strong px-0 pt-3 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
                >
                  Repo
                </th>
                <th
                  scope="col"
                  className="border-b border-rule-strong px-0 pt-3 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
                >
                  Ref
                </th>
                <th
                  scope="col"
                  className="border-b border-rule-strong px-0 pt-3 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
                >
                  Head
                </th>
                <th
                  scope="col"
                  className="border-b border-rule-strong px-0 pt-3 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="border-b border-rule-strong px-0 pt-3 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
                >
                  Risk
                </th>
                <th
                  scope="col"
                  className="border-b border-rule-strong px-0 pt-3 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
                >
                  Findings
                </th>
                <th
                  scope="col"
                  className="border-b border-rule-strong px-0 pt-3 pb-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
                >
                  Scanned (UTC)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ScansLedgerRow
                  key={`${row.repo}-${row.ref}-${row.head_sha}-${row.created_at}`}
                  row={row}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
