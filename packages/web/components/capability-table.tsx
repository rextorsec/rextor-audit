import { cn } from "@/lib/utils";

export type CompetitorCell = "no" | "partial" | "yes";

export interface RextorCell {
  shipped: boolean;
  receipt?: string;
  receiptLabel?: string;
  /** Multiple live receipts for one claim (e.g. Tempo + Solana on
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
     the matrix rules; the approved 2026-09-18 mock renders all 15 rows, so the
     production data file raises it explicitly. */
  maxSoonRows?: number;
  rows: CapabilityRow[];
}

/** Dates rendered with non-breaking hyphens, per the approved mock copy. */
export function datedAsOf(asOf: string): string {
  return asOf.replaceAll("-", "‑");
}

const chapterPara = (asOf: string) => (
  <p>
    Every green check links a live artifact. Dashes mean "not evidenced on public product pages as
    of {datedAsOf(asOf)}" — we date‑stamp the competition instead of guessing about it.
  </p>
);

const chapterFootnote = (asOf: string) => (
  <p className="mt-4 max-w-[72ch] font-mono text-xs text-subtle-foreground">
    ✔ = shipped, links to its live artifact. "Shipping Oct 2026" = on the plan, not yet shipped —
    tracked openly in our repo, never faked. ●◐— relative to public product pages as of{" "}
    {datedAsOf(asOf)}.
  </p>
);

const chapterHead =
  "mb-4 max-w-[55ch] [&>h2]:mb-2 [&>h2]:text-2xl [&>h2]:font-bold [&>h2]:leading-[1.1] [&>h2]:tracking-[-0.02em] [&>h2]:[overflow-wrap:anywhere] [&>p]:text-muted-foreground";

const chapterCell =
  "py-3 pr-4 border-b border-border align-top max-[60rem]:block max-[60rem]:border-b-0 max-[60rem]:py-1 max-[60rem]:before:inline-block max-[60rem]:before:min-w-[12ch] max-[60rem]:before:font-mono max-[60rem]:before:text-xs max-[60rem]:before:uppercase max-[60rem]:before:text-subtle-foreground max-[60rem]:before:content-[attr(data-label)]";

const chapterValue: Record<CompetitorCell, string> = {
  no: "text-subtle-foreground",
  partial: "text-muted-foreground",
  yes: "text-primary font-medium",
};

function competitorCell(value: CompetitorCell, label: string) {
  return (
    <td data-label={label} className={cn(chapterCell, chapterValue[value])}>
      {value === "no" ? "—" : value === "partial" ? "◐" : "✔"}
    </td>
  );
}

function SoonBadge({ children }: { children: string }) {
  return (
    <span className="inline-block rounded-full border border-border px-2 py-px font-mono text-xs whitespace-nowrap text-muted-foreground">
      {children}
    </span>
  );
}

function RextorCellView({ rextor }: { rextor: CapabilityRow["rextor"] }) {
  if (rextor.soon && !rextor.shipped) {
    return (
      <>
        ✔ <SoonBadge>Shipping Oct 2026</SoonBadge>
      </>
    );
  }
  return (
    <>
      ✔{" "}
      {rextor.receipts
        ? rextor.receipts.map((r, i) => (
            <span key={r.href}>
              {i > 0 && " · "}
              <a
                className="font-mono text-sm no-underline whitespace-nowrap text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]"
                href={r.href}
              >
                {r.label}
              </a>
            </span>
          ))
        : rextor.receipt && (
            <a
              className="font-mono text-sm no-underline whitespace-nowrap text-primary hover:underline hover:decoration-2 hover:underline-offset-[3px]"
              href={rextor.receipt}
            >
              {rextor.receiptLabel ?? rextor.receipt}
            </a>
          )}
      {rextor.soonChips?.map((chip) => (
        <span key={chip} className="ml-2">
          <SoonBadge>{chip}</SoonBadge>
        </span>
      ))}
    </>
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

  return (
    <section className="py-16" id="matrix" aria-label="Capability matrix">
      <div className={chapterHead}>
        <h2>What actually ships</h2>
        {chapterPara(data.asOf)}
      </div>
      <table className="w-full border-collapse text-sm tabular-nums max-[60rem]:block">
        <thead className="max-[60rem]:hidden">
          <tr>
            <th
              scope="col"
              className="border-b border-rule-strong py-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
            >
              Capability
            </th>
            <th
              scope="col"
              className="border-b border-rule-strong py-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
            >
              Generic AI review
            </th>
            <th
              scope="col"
              className="border-b border-rule-strong py-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
            >
              One‑shot audit bots
            </th>
            <th
              scope="col"
              className="border-b border-rule-strong py-3 pr-4 text-left font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground"
            >
              Rextor Audit
            </th>
          </tr>
        </thead>
        <tbody className="max-[60rem]:block">
          {visibleRows.map((row) => (
            <tr
              key={row.id}
              className="max-[60rem]:block max-[60rem]:border-b max-[60rem]:border-border max-[60rem]:py-3"
            >
              <td data-label="Rextor" className={cn(chapterCell, "text-foreground")}>
                {row.capability}
              </td>
              {competitorCell(row.generic, "Generic")}
              {competitorCell(row.bots, "Bots")}
              <td data-label="Rextor" className={cn(chapterCell, "font-medium text-primary")}>
                <RextorCellView rextor={row.rextor} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {chapterFootnote(data.asOf)}
    </section>
  );
}