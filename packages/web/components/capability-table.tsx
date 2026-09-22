import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CompetitorCell = "no" | "partial" | "yes";

export interface RextorCell {
  shipped: boolean;
  receipt?: string;
  receiptLabel?: string;
  /** Multiple live receipts for one claim (e.g. Tempo + HyperEVM + Solana on
   *  onchain-verdict). When present, renders INSTEAD of the single receipt. */
  receipts?: Array<{ href: string; label: string }>;
  soon?: boolean;
  soonChips?: string[];
}

export interface CapabilityRow {
  id: string;
  capability: string;
  generic: CompetitorCell;
  bots: "no" | "partial";
  rextor: RextorCell;
  backing: string;
}

export interface Capabilities {
  asOf: string;
  /* Chapter soon-budget (rows visible with the dated-soon badge). Default 2 per
     the matrix rules; the production data file raises it explicitly. */
  maxSoonRows?: number;
  rows: CapabilityRow[];
}

/** Dates rendered with non-breaking hyphens, per the approved mock copy. */
export function datedAsOf(asOf: string): string {
  return asOf.replaceAll("-", "‑");
}

/* ── mark system — dot language shared with the hero receipt ─────────────── */

const MARK_ARIA: Record<CompetitorCell, string> = {
  yes: "shipped",
  partial: "partial",
  no: "not evidenced",
};

function Mark({ kind }: { kind: CompetitorCell }) {
  return (
    <span
      role="img"
      aria-label={MARK_ARIA[kind]}
      className={cn(
        "inline-block size-2 flex-none rounded-full align-[-0.5px]",
        kind === "yes" && "bg-primary",
        kind === "partial" && "mark-partial",
        kind === "no" && "mark-no",
      )}
    />
  );
}

/* ── cells ──────────────────────────────────────────────────────────────── */

const receiptLinkClass =
  "font-mono text-xs no-underline whitespace-nowrap text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]";

const cellClass =
  "py-3 pr-4 border-b border-border align-top max-[60rem]:block max-[60rem]:border-b-0 max-[60rem]:py-1 max-[60rem]:before:mr-3 max-[60rem]:before:inline-block max-[60rem]:before:min-w-[7ch] max-[60rem]:before:font-mono max-[60rem]:before:text-xs max-[60rem]:before:uppercase max-[60rem]:before:text-faint-foreground max-[60rem]:before:content-[attr(data-label)] max-[60rem]:before:content-[attr(data-label)'·']";

const thClass =
  "border-b border-rule-strong py-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.1em] uppercase text-subtle-foreground";

function SoonBadge({ children }: { children: string }) {
  return (
    <span className="inline-block rounded-sm border border-border px-2 py-px font-mono text-xs whitespace-nowrap text-subtle-foreground">
      {children}
    </span>
  );
}

function CompetitorTd({ value, label }: { value: CompetitorCell; label: string }) {
  return (
    <td data-label={label} className={cellClass}>
      <Mark kind={value} />
    </td>
  );
}
function RextorCellView({ rextor }: { rextor: RextorCell }) {
  let content: ReactNode;
  if (!rextor.shipped) {
    content = <SoonBadge>Oct 2026</SoonBadge>;
  } else {
    content = (
      <>
        <Mark kind="yes" />{" "}
        {rextor.receipts
          ? rextor.receipts.map((r) => (
              <span key={r.href}>
                <a className={receiptLinkClass} href={r.href}>
                  {r.label}
                </a>{" "}
              </span>
            ))
          : rextor.receipt && (
              <a className={receiptLinkClass} href={rextor.receipt}>
                {rextor.receiptLabel ?? rextor.receipt}
              </a>
            )}
      </>
    );
  }
  return (
    <>
      {content}
      {rextor.soonChips?.map((chip) => (
        <span key={chip} className="ml-1">
          <SoonBadge>{chip}</SoonBadge>
        </span>
      ))}
    </>
  );
}

/* ── table ──────────────────────────────────────────────────────────────── */

function MatrixTable({ rows }: { rows: CapabilityRow[] }) {
  return (
    <table className="w-full border-collapse text-sm tabular-nums max-[60rem]:block">
      <thead className="max-[60rem]:hidden">
        <tr>
          <th scope="col" className={thClass}>
            Capability
          </th>
          <th scope="col" className={thClass}>
            Generic AI review
          </th>
          <th scope="col" className={thClass}>
            One-shot audit bots
          </th>
          <th scope="col" className={cn(thClass, "rextor-col")}>
            Rextor Audit
          </th>
        </tr>
      </thead>
      <tbody className="max-[60rem]:block">
        {rows.map((row) => (
          <tr
            key={row.id}
            className="matrix-row transition-colors max-[60rem]:block max-[60rem]:border-t max-[60rem]:border-border max-[60rem]:py-4 max-[60rem]:first:border-t-0 [&>td]:transition-colors"
          >
            <td data-label="Capability" className={cn(cellClass, "font-medium text-foreground")}>
              {row.capability}
            </td>
            <CompetitorTd value={row.generic} label="Generic" />
            <CompetitorTd value={row.bots} label="Bots" />
            <td data-label="Rextor" className={cn(cellClass, "rextor-col")}>
              <RextorCellView rextor={row.rextor} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CapabilityTable({ data }: { data: Capabilities }) {
  const budget = data.maxSoonRows ?? 2;
  let soonSeen = 0;
  const visibleRows = data.rows.filter((row) => {
    if (row.rextor.soon && !row.rextor.shipped) {
      soonSeen += 1;
      return soonSeen <= budget;
    }
    return true;
  });

  // Split is DATA-driven: receipts land in "Live now", the rest stay "Tracked
  // openly". The tracked group hides entirely when empty.
  const liveRows = visibleRows.filter((row) => row.rextor.shipped);
  const trackedRows = visibleRows.filter((row) => !row.rextor.shipped);

  return (
    <section className="pb-16 pt-10" id="matrix" aria-label="Capability matrix">
      <h2 className="mb-2 text-2xl font-semibold leading-[1.15] tracking-[-0.02em] [overflow-wrap:anywhere]">
        What actually ships
      </h2>
      <p className="m-0 mb-10 max-w-[60ch] text-muted-foreground">
        Live rows carry their receipt — every mark links its artifact. Competitor marks are
        datestamped, not guessed.
      </p>

      <h3 className="m-0 mb-4 font-mono text-xs tracking-[0.1em] uppercase tabular-nums text-subtle-foreground">
        Live now · <b className="font-medium text-foreground">{liveRows.length} receipts</b>
      </h3>
      <MatrixTable rows={liveRows} />

      {trackedRows.length > 0 && (
        <>
          <h3 className="m-0 mt-16 mb-4 font-mono text-xs tracking-[0.1em] uppercase tabular-nums text-subtle-foreground">
            Tracked openly ·{" "}
            <b className="font-medium text-foreground">{trackedRows.length} on the plan</b>
          </h3>
          <MatrixTable rows={trackedRows} />
        </>
      )}

      <p className="mt-4 m-0 max-w-[72ch] font-mono text-xs leading-[1.6] text-subtle-foreground">
        <Mark kind="yes" /> shipped · <Mark kind="partial" /> partial · <Mark kind="no" /> not
        evidenced — competitor marks relative to public product pages as of {datedAsOf(data.asOf)}.
      </p>
    </section>
  );
}
