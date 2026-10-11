// SPEC-6 §3 — Deep Scan report view (approved mockups/deep-scan/report.html).
// Pure render: no fetching, no state — the trigger hands it a ScanReport.
// Every scan-derived string is UNTRUSTED service output: rendered as inert
// text via React escaping only, never dangerouslySetInnerHTML.
//
// Zero-meaningful display rules: risk_score null renders "—" (never a fake 0)
// with the "no score — incomplete" microcopy; finding_count 0 renders visibly
// ("0 findings — clean pass", a clean pass is shown, never hidden);
// head_sha "" renders "—". Status mirrors the on-chain encoding: 0 complete,
// 1 INCOMPLETE; an INCOMPLETE report keeps its hero with the reason line and
// both cause chips; degradation chips annotate a run while status stays 0.
// suggestedDiff and learningNote are presentation-only and are never treated
// as attested data.
import { Fragment } from "react";

import type { ScanFinding, ScanReport } from "@/lib/scans";

// Severity encoding (approved mock): critical/high carry the danger/warning
// tokens; medium/low render muted ink. No new colors.
const SEVERITY: Record<ScanFinding["severity"], { dot: string; ink: string }> = {
  critical: { dot: "bg-danger", ink: "text-danger" },
  high: { dot: "bg-warning", ink: "text-warning" },
  medium: { dot: "bg-muted-foreground", ink: "text-muted-foreground" },
  low: { dot: "bg-subtle-foreground", ink: "text-subtle-foreground" },
};

const CHIP =
  "inline-block rounded-full border px-sm py-0 font-mono text-xs tabular-nums whitespace-nowrap";
const CHIP_WARN = `${CHIP} border-warning text-warning whitespace-normal`;
const CHIP_PLAIN = `${CHIP} border-border text-muted-foreground whitespace-normal`;

/** suggestedDiff renders with the mock's add/del/ctx line tones. Line-prefix
 *  classification is presentation only — the text itself stays escaped. */
function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="min-w-0 overflow-x-auto rounded-sm border border-border bg-card px-md py-sm font-mono text-xs leading-[1.7]">
      {diff.split("\n").map((line, i) => (
        <span
          key={i}
          className={`block whitespace-pre ${
            line.startsWith("+")
              ? "text-success"
              : line.startsWith("-")
                ? "text-danger"
                : "text-muted-foreground"
          }`}
        >
          {line.length > 0 ? line : " "}
        </span>
      ))}
    </pre>
  );
}

/** poc is typed `unknown` at the service boundary: strings render verbatim,
 *  anything else serializes honestly. Never executed, never injected. */
function pocText(poc: unknown): string {
  if (typeof poc === "string") return poc;
  try {
    return JSON.stringify(poc, null, 2) ?? "";
  } catch {
    return String(poc);
  }
}

function FindingRow({ finding }: { finding: ScanFinding }) {
  const sev = SEVERITY[finding.severity];
  return (
    <tr>
      <td className="whitespace-nowrap border-b border-border py-md pr-md align-top">
        <span className={`inline-flex items-center gap-2xs font-mono text-xs ${sev.ink}`}>
          <span className={`h-2 w-2 flex-none rounded-[1px] ${sev.dot}`} aria-hidden="true" />
          {finding.severity}
        </span>
      </td>
      <td className="whitespace-nowrap border-b border-border py-md pr-md align-top">
        <code className="font-mono text-xs text-foreground">{finding.check}</code>
      </td>
      <td className="border-b border-border py-md pr-md align-top">
        <code className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {finding.file}:{finding.line}
        </code>
      </td>
      <td className="border-b border-border py-md pr-md align-top">{finding.description}</td>
    </tr>
  );
}

/** The FIRST finding renders expanded (approved mock): triage note, suggested
 *  fix, PoC, merged checks, learnings — only the fields the run carried. */
function FindingDetailRow({ finding }: { finding: ScanFinding }) {
  return (
    <tr>
      <td className="border-b border-border pt-0 pr-md pb-md" colSpan={4}>
        <details className="group" open>
          <summary className="cursor-pointer list-none whitespace-nowrap font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground outline-none before:text-subtle-foreground before:content-['▸_'] group-open:before:content-['▾_'] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            triage detail · finding #0
          </summary>
          <div className="mt-sm grid min-w-0 gap-md border-t border-border pt-md">
            {finding.triageNote ? (
              <section>
                <h3 className="mb-2xs font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
                  triage note
                </h3>
                <p className="max-w-[74ch] text-sm">{finding.triageNote}</p>
              </section>
            ) : null}
            {finding.suggestedDiff ? (
              <section>
                <h3 className="mb-2xs font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
                  suggested fix — review before applying
                </h3>
                <DiffBlock diff={finding.suggestedDiff} />
              </section>
            ) : null}
            {finding.poc !== undefined ? (
              <section>
                <h3 className="mb-2xs font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
                  proof of concept
                </h3>
                <pre className="min-w-0 overflow-x-auto rounded-sm border border-border bg-elevated px-md py-sm font-mono text-xs leading-[1.7] whitespace-pre text-foreground">
                  {pocText(finding.poc)}
                </pre>
              </section>
            ) : null}
            {finding.mergedChecks && finding.mergedChecks.length > 0 ? (
              <section>
                <h3 className="mb-2xs font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
                  merged checks
                </h3>
                <ul className="grid list-none gap-3xs">
                  {finding.mergedChecks.map((check) => (
                    <li
                      key={check}
                      className="relative pr-md pl-md font-mono text-xs text-muted-foreground before:absolute before:left-0 before:text-subtle-foreground before:content-['·']"
                    >
                      <code className="text-foreground">{check}</code>
                    </li>
                  ))}
                </ul>
                <p className="mt-2xs text-xs text-subtle-foreground">
                  deduped by triage — every detector hit stays recorded on the finding.
                </p>
              </section>
            ) : null}
            {finding.learningNote ? (
              <section>
                <h3 className="mb-2xs font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
                  server-side learnings ledger
                </h3>
                <p className="max-w-[74ch] text-sm">{finding.learningNote}</p>
              </section>
            ) : null}
          </div>
        </details>
      </td>
    </tr>
  );
}

export function ScanReportView({ report }: { report: ScanReport }) {
  const incomplete = report.status === 1;
  const riskNull = report.risk_score === null;
  const zeroFindings = !incomplete && report.finding_count === 0;
  const findingsValue = incomplete ? "—" : report.finding_count;
  const findingsLabel = zeroFindings ? "findings — clean pass" : "findings";

  return (
    <article aria-label="Deep scan report">
      <header className="py-lg pb-xl">
        <div className="flex flex-wrap items-center gap-sm gap-x-md">
          <p className="min-w-0 font-mono text-sm break-all text-muted-foreground tabular-nums">
            <span className="text-foreground">{report.repo}</span> · {report.ref} @{" "}
            {report.head_sha ? report.head_sha.slice(0, 7) : "—"}
          </p>
          {incomplete ? (
            <span className={CHIP_WARN}>status 1 · INCOMPLETE</span>
          ) : (
            <span className={`${CHIP} border-success text-success`}>status 0 · complete</span>
          )}
        </div>
        <h1 className="mt-2xs text-xl font-bold tracking-[-0.02em] [overflow-wrap:anywhere]">
          Deep scan report
        </h1>
        <div className="mt-lg grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-start gap-lg gap-x-2xl max-md:grid-cols-1">
          <div
            className="min-w-0"
            role="group"
            aria-label={
              report.risk_score === null
                ? "No risk score — incomplete"
                : `Risk score ${report.risk_score} of 100`
            }
          >
            <p
              className={`font-mono text-display-s leading-[1.05] font-medium tracking-[-0.02em] tabular-nums ${
                riskNull ? "text-muted-foreground" : "text-success"
              }`}
            >
              {riskNull ? "—" : report.risk_score}
              <span className="text-md font-normal text-muted-foreground"> / 100</span>
            </p>
            <p className="mt-3xs font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground">
              risk score
            </p>
            <p className="mt-3xs font-mono text-xs text-subtle-foreground">
              {riskNull ? "no score — incomplete" : "0–100 · higher = riskier"}
            </p>
          </div>
          <div className="grid min-w-0 gap-md">
            <div>
              <p
                className={`font-mono text-xl leading-[1.15] font-medium tabular-nums ${
                  zeroFindings ? "text-success" : ""
                }`}
              >
                {findingsValue}
              </p>
              <p className="mt-3xs font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground">
                {findingsLabel}
              </p>
            </div>
            <dl className="font-mono text-xs tabular-nums">
              <div className="grid grid-cols-[minmax(0,12ch)_minmax(0,1fr)] gap-md py-2xs">
                <dt className="text-subtle-foreground">ref</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">{report.ref}</dd>
              </div>
              <div className="grid grid-cols-[minmax(0,12ch)_minmax(0,1fr)] gap-md py-2xs">
                <dt className="text-subtle-foreground">head</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">
                  {report.head_sha || "—"}
                </dd>
              </div>
            </dl>
            {report.degraded && report.degraded.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center gap-sm">
                  {report.degraded.map((note) => (
                    <span key={note} className={CHIP_WARN}>
                      degraded · {note}
                    </span>
                  ))}
                  <span className={CHIP_PLAIN}>status stays 0</span>
                </div>
                <p className="mt-2xs max-w-[62ch] text-xs text-muted-foreground">
                  Degradation notes annotate the run — they ride along with a complete status
                  and never change the verdict. Findings stand exactly as reported.
                </p>
              </>
            ) : null}
            {incomplete ? (
              <>
                <p className="max-w-[62ch] text-xs text-muted-foreground">
                  {report.incomplete
                    ? report.incomplete
                    : "Analysis did not complete — the run ended before the analyzer reported."}{" "}
                  The cause chip says which side failed:
                </p>
                <div className="flex flex-wrap items-center gap-sm">
                  <span className={report.incompleteCause === "infra" ? CHIP_WARN : CHIP_PLAIN}>
                    infra — not a verdict on the code
                  </span>
                  <span className={report.incompleteCause === "content" ? CHIP_WARN : CHIP_PLAIN}>
                    content — nothing in scope to analyze
                  </span>
                </div>
                <p className="mt-2xs max-w-[62ch] text-xs text-muted-foreground">
                  infra: service-side failure — no judgment about the code was made. content:
                  the run completed but nothing in scope matched — also not a verdict.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <section aria-label="Findings" className="py-lg pb-2xl">
        <h2 className="mb-md font-mono text-xs font-normal tracking-[0.12em] uppercase text-subtle-foreground">
          Findings
        </h2>
        {report.findings.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-sm tabular-nums">
                <thead>
                  <tr>
                    <th className="border-b border-rule-strong py-sm pr-md text-left font-mono text-xs font-normal tracking-[0.12em] uppercase whitespace-nowrap text-subtle-foreground">
                      Severity
                    </th>
                    <th className="border-b border-rule-strong py-sm pr-md text-left font-mono text-xs font-normal tracking-[0.12em] uppercase whitespace-nowrap text-subtle-foreground">
                      Check
                    </th>
                    <th className="border-b border-rule-strong py-sm pr-md text-left font-mono text-xs font-normal tracking-[0.12em] uppercase whitespace-nowrap text-subtle-foreground">
                      Location
                    </th>
                    <th className="border-b border-rule-strong py-sm pr-md text-left font-mono text-xs font-normal tracking-[0.12em] uppercase whitespace-nowrap text-subtle-foreground">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.findings.map((finding, index) => (
                    <Fragment key={`${finding.check}:${finding.line}:${index}`}>
                      <FindingRow finding={finding} />
                      {index === 0 ? <FindingDetailRow finding={finding} /> : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-md flex flex-wrap gap-sm gap-x-lg" aria-label="Severity encoding">
              {(Object.keys(SEVERITY) as Array<ScanFinding["severity"]>).map((name) => (
                <span key={name} className={`inline-flex items-center gap-2xs font-mono text-xs ${SEVERITY[name].ink}`}>
                  <span className={`h-2 w-2 flex-none rounded-[1px] ${SEVERITY[name].dot}`} aria-hidden="true" />
                  {name}
                </span>
              ))}
            </div>
            <p className="mt-2xs font-mono text-xs text-subtle-foreground">
              severity encoding — critical/high carry the danger/warning tokens; medium/low render muted ink
            </p>
          </>
        ) : zeroFindings ? (
          <div
            className="rounded-lg border border-dashed border-rule-strong p-xl text-center"
            aria-label="Clean pass"
          >
            <p className="font-mono text-sm font-medium text-success">0 findings — clean pass</p>
            <p className="mx-auto mt-2xs max-w-[46ch] text-sm text-muted-foreground">
              the run completed at this head with nothing flagged.
            </p>
          </div>
        ) : null}
      </section>
    </article>
  );
}
