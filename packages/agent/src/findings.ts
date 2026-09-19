// SPEC-1 §3 — findings normalizer + riskScore rubric v0.
// Input is the analyzer container's NDJSON (SPEC-1 §1). A failure report
// (`{"status":"incomplete","reason":…}`) throws `IncompleteReportError` —
// the error type SPEC-2 triage must preserve end-to-end. Garbage never
// silently skips: every bad line throws with its 1-based line number.

import { createHash } from "node:crypto";

export type Severity = "critical" | "high" | "medium" | "low";

export interface PocInfo {
  status: "confirmed" | "unproven" | "skipped";
  testSource?: string;
  block?: number;
}

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  check: string;
  description: string;
  id?: number;
  triageNote?: string;
  mergedChecks?: string[];
  poc?: PocInfo;
  /** SPEC-7 §2 — triage-proposed fix (presentation only). NEVER enters the
   *  canonical attestation payload: the on-chain hash covers finding
   *  evidence, not suggested remediations (canonicalFindingsJson strips it). */
  suggestedDiff?: string;
  /** SPEC-7 §4 — recurrence annotation from the server-side learnings ledger.
   *  Derived from SERVER state (not recomputable by third parties), so it is
   *  stripped from the canonical payload exactly like suggestedDiff. */
  learningNote?: string;
}

export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];

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

/** Assign stable 0-based ids in analyzer order (SPEC-2 §1). Non-destructive. */
export function withIds(findings: Finding[]): Finding[] {
  return findings.map((f, id) => ({ ...f, id }));
}

/** Rubric v1 (SPEC-2 §2): v0 weights + one poc-aware rule. */
export function scoreV1(findings: Finding[]): number {
  const total = findings.reduce((sum, f) => {
    const w = f.severity === "critical" && f.poc?.status === "unproven" ? 25 : RUBRIC[f.severity];
    return sum + w;
  }, 0);
  return Math.min(total, SCORE_CAP);
}

function stableValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stableValue);
  if (v !== null && typeof v === "object") {
    const src = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(src)
        .filter((k) => src[k] !== undefined)
        .sort()
        .map((k) => [k, stableValue(src[k])]),
    );
  }
  return v;
}

/** SPEC-2 §2 canonical form: sorted keys, compact, backticks escaped as \u0060.
 *  SPEC-7 §2/§4 — suggestedDiff + learningNote are stripped here: the attested
 *  findingsHash covers finding EVIDENCE only. Suggestions are presentation;
 *  learning counts are server-side state nobody outside can recompute. */
export function canonicalFindingsJson(findings: Finding[]): string {
  const attestable = findings.map(({ suggestedDiff: _s, learningNote: _l, ...rest }) => rest);
  return JSON.stringify(stableValue(attestable)).replaceAll("`", "\\u0060");
}

export function findingsHash(findings: Finding[]): string {
  return createHash("sha256").update(canonicalFindingsJson(findings), "utf8").digest("hex");
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
  // A finding line must be a non-negative integer: fractional or negative
  // values are corrupt analyzer output, not locatable source positions.
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new Error(
      `findings NDJSON line ${lineNo}: "${key}" must be a non-negative integer, got ${show(v)}`,
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
