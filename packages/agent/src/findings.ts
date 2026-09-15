// SPEC-1 §3 — findings normalizer + riskScore rubric v0.
// Input is the analyzer container's NDJSON (SPEC-1 §1). A failure report
// (`{"status":"incomplete","reason":…}`) throws `IncompleteReportError` —
// the error type SPEC-2 triage must preserve end-to-end. Garbage never
// silently skips: every bad line throws with its 1-based line number.

export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  check: string;
  description: string;
}

const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];

// Rubric v0 — published weights. `score` is a pure function of findings so
// anyone can recompute it from the published findings JSON (SPEC-1 §3).
const RUBRIC: Record<Severity, number> = {
  critical: 60,
  high: 25,
  medium: 10,
  low: 3,
};

const SCORE_CAP = 100;

export class IncompleteReportError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`analyzer report incomplete: ${reason}`);
    this.name = "IncompleteReportError";
    this.reason = reason;
  }
}

export function normalizeFindings(ndjson: string): Finding[] {
  const findings: Finding[] = [];
  const lines = ndjson.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue; // trailing-newline / blank-line tolerance
    findings.push(parseFindingLine(line, i + 1));
  }
  return findings;
}

export function score(findings: Finding[]): number {
  const total = findings.reduce((sum, f) => sum + RUBRIC[f.severity], 0);
  return Math.min(total, SCORE_CAP);
}

function parseFindingLine(line: string, lineNo: number): Finding {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    const preview = line.length > 120 ? line.slice(0, 117) + "..." : line;
    throw new Error(
      `findings NDJSON line ${lineNo} is not valid JSON: ${preview}`,
      { cause },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `findings NDJSON line ${lineNo} must be a JSON object, got: ${JSON.stringify(parsed)}`,
    );
  }
  const rec = parsed as Record<string, unknown>;
  if (rec.status === "incomplete") {
    throw new IncompleteReportError(
      typeof rec.reason === "string" ? rec.reason : show(rec.reason),
    );
  }
  return {
    file: requireString(rec, "file", lineNo),
    line: requireNumber(rec, "line", lineNo),
    severity: requireSeverity(rec, lineNo),
    check: requireString(rec, "check", lineNo),
    description: requireString(rec, "description", lineNo),
  };
}

function requireString(
  rec: Record<string, unknown>,
  key: string,
  lineNo: number,
): string {
  const v = rec[key];
  if (typeof v !== "string") {
    throw new Error(
      `findings NDJSON line ${lineNo}: "${key}" must be a string, got ${show(v)}`,
    );
  }
  return v;
}

function requireNumber(
  rec: Record<string, unknown>,
  key: string,
  lineNo: number,
): number {
  const v = rec[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(
      `findings NDJSON line ${lineNo}: "${key}" must be a finite number, got ${show(v)}`,
    );
  }
  return v;
}

function requireSeverity(rec: Record<string, unknown>, lineNo: number): Severity {
  const v = rec.severity;
  if (typeof v !== "string" || !SEVERITIES.includes(v as Severity)) {
    throw new Error(
      `findings NDJSON line ${lineNo}: "severity" must be one of ${SEVERITIES.join("|")}, got ${show(v)}`,
    );
  }
  return v as Severity;
}

function show(v: unknown): string {
  return JSON.stringify(v) ?? "undefined";
}
