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

/**
 * WHY a review went incomplete. "infra" = infrastructure failure (analyzer
 * crash/timeout/exit≠0, clone or GitHub failure, unparseable report) — NOT a
 * verdict on the code. "content" = nothing in scope to analyze. The cause is
 * classified here at the report boundary (incompleteCauseFor) and carried on
 * IncompleteReportError / ReviewResult.incompleteCause; downstream consumers
 * never re-derive it.
 */
export type IncompleteCause = "infra" | "content";

// The ONLY reasons that count as "content": the analyzer scripts' enumerated
// nothing-in-scope emissions (run.sh/evm.sh/solana.sh) — a repo carrying
// nothing of its own for the dispatched engine to analyze. A closed
// exact-match table is the point: an unknown reason can NEVER classify as
// content, so every reader-facing "nothing in scope" claim is grounded.
// (`=== true`, never truthiness: prototype keynames like "constructor" must
// not sneak through.)
const CONTENT_REASONS: Record<string, true> = {
  "no-contract-analyzed": true, // evm.sh — slither ran but analyzed no contracts
  "no-sol-sources": true, // evm.sh — no own .sol sources (structural fallback)
  "no-rust-analyzed": true, // solana.sh — Anchor-dispatched repo with no Rust
};

/**
 * Deterministic cause for an analyzer INCOMPLETE reason string. Everything
 * outside the closed content table above — analyzer exit≠0, timeout, crash,
 * slice-failed-rc-N, evm-copy-failed, unparseable reports, github setup
 * failures, and any future/unknown reason — is "infra".
 */
export function incompleteCauseFor(reason: string): IncompleteCause {
  // Scoped degradation prefixes the scope ("evm: slither-error: …", SPEC-8 §1);
  // strip it so a degraded note classifies identically to its raw reason.
  const raw = reason.replace(/^(?:solana|evm|dual): /, "");
  return CONTENT_REASONS[raw] === true ? "content" : "infra";
}

export class IncompleteReportError extends Error {
  readonly reason: string;
  /** Infra-vs-content stamp (incompleteCauseFor) — callers never re-derive. */
  readonly incompleteCause: IncompleteCause;

  constructor(reason: string, incompleteCause: IncompleteCause) {
    super(`analyzer report incomplete: ${reason}`);
    this.name = "IncompleteReportError";
    this.reason = reason;
    this.incompleteCause = incompleteCause;
  }
}

type ParsedLine =
  | { kind: "finding"; finding: Finding }
  | { kind: "incomplete"; reason: string; scope?: string };

function classifyFindingLine(line: string, lineNo: number): ParsedLine {
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
    return {
      kind: "incomplete",
      reason: typeof rec.reason === "string" ? rec.reason : show(rec.reason),
      scope: typeof rec.scope === "string" ? rec.scope : undefined,
    };
  }
  return {
    kind: "finding",
    finding: {
      file: requireString(rec, "file", lineNo),
      line: requireNumber(rec, "line", lineNo),
      severity: requireSeverity(rec, lineNo),
      check: requireString(rec, "check", lineNo),
      description: requireString(rec, "description", lineNo),
    },
  };
}

export function normalizeFindings(ndjson: string): Finding[] {
  const findings: Finding[] = [];
  const lines = ndjson.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue; // trailing-newline / blank-line tolerance
    const parsed = classifyFindingLine(line, i + 1);
    if (parsed.kind === "incomplete") {
      throw new IncompleteReportError(parsed.reason, incompleteCauseFor(parsed.reason));
    }
    findings.push(parsed.finding);
  }
  return findings;
}

/** Result of parsing a possibly dual-dispatch analyzer report (SPEC-8 §1). */
export interface AnalyzerReport {
  findings: Finding[];
  /** Per-scope degradation notes, e.g. `["evm: slither-error: …"]`. Each entry
   *  means THAT scope did not complete — rendered as a visible comment note,
   *  never silently dropped. Presentation-only: never enters the attestation
   *  payload. */
  degraded: string[];
}

/** SPEC-8 §1 monorepo entry: dual-dispatch reports carry scoped
 *  `status:"incomplete"` lines (`"scope":"solana"|"evm"|"dual"`). A scoped
 *  incomplete DEGRADES instead of throwing — a mixed-shape repo must not lose
 *  the side that scanned clean just because the other half failed; the
 *  degradation rides back as a visible note. UNSCOPED incomplete lines stay
 *  hard throws (single-shape repos behave byte-identically to pre-dual).
 *  Zero findings + only degradations = the report IS incomplete: throws with
 *  every scope's reason joined. */
export function parseAnalyzerReport(ndjson: string): AnalyzerReport {
  const findings: Finding[] = [];
  const degraded: string[] = [];
  // Raw causes parallel to `degraded` (whose entries carry the "scope: "
  // prefix): the combined throw classifies from the RAW reasons, so the
  // joined message never has to be re-parsed downstream.
  const degradedCauses: IncompleteCause[] = [];
  const lines = ndjson.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue; // trailing-newline / blank-line tolerance
    const parsed = classifyFindingLine(line, i + 1);
    if (parsed.kind === "incomplete") {
      if (parsed.scope === undefined) {
        throw new IncompleteReportError(parsed.reason, incompleteCauseFor(parsed.reason));
      }
      degraded.push(`${parsed.scope}: ${parsed.reason}`);
      degradedCauses.push(incompleteCauseFor(parsed.reason));
      continue;
    }
    findings.push(parsed.finding);
  }
  if (findings.length === 0 && degraded.length > 0) {
    // Mixed causes read as infra: a reader must never be told "nothing in
    // scope" while any scope ALSO failed on infrastructure.
    const cause: IncompleteCause = degradedCauses.every((c) => c === "content")
      ? "content"
      : "infra";
    throw new IncompleteReportError(degraded.join(" | "), cause);
  }
  return { findings, degraded };
}

/**
 * Timeout salvage: parse analyzer stdout that a SIGKILL cut mid-stream (the
 * exec kills the container on its wall-clock budget; run.sh streams each
 * slice's NDJSON the moment that slice exits, so the stdout captured before
 * the kill holds every completed slice). The kill can truncate the final
 * NDJSON write, so a trailing line without its newline terminator is DROPPED
 * — parsing it would throw unparseable and discard the finished slices with
 * it. Everything before it parses under the EXACT normal rules
 * (parseAnalyzerReport: scoped degradation included), so a mid-stream corrupt
 * line still throws → null — only end-of-stream truncation is recoverable.
 * Returns null when nothing usable survived.
 */
export function salvageAnalyzerReport(partial: string): AnalyzerReport | null {
  if (partial.trim() === "") return null;
  const terminated = partial.endsWith("\n")
    ? partial
    : partial.slice(0, partial.lastIndexOf("\n") + 1);
  if (terminated.trim() === "") return null;
  try {
    return parseAnalyzerReport(terminated);
  } catch {
    return null;
  }
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
