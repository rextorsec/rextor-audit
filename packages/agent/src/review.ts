// SPEC-1 §4 — review runner: fetch diff → scope → analyzer container →
// normalize → score → exactly ONE PR comment. GitHub I/O (clone / diff /
// comment) and the analyzer run are injected as `ReviewDeps` so tests run the
// REAL pipeline with only the I/O faked (controller ruling 9).
//
// Integrity invariant (SPEC-1 cross-cutting #2): an analyzer that cannot
// produce a complete report — crash, timeout, non-report garbage, or the
// contract's `{"status":"incomplete"}` line — surfaces as an INCOMPLETE PR
// comment with the reason. Never a silent clean pass.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { scopeDiff, type DiffScopeResult } from "./diff-scope";
import { NO_TRIAGE_MODEL, rawFindingsResult, type TriageResult } from "./triage";
import { runSimStage, sanitizePocSource, type PocRequest, type SimOutcomeMap } from "./sim";
import {
  canonicalFindingsJson,
  normalizeFindings,
  scoreV1,
  withIds,
  IncompleteReportError,
  type Finding,
  type Severity,
} from "./findings";

export type { Finding };

export interface ReviewDeps {
  /** LLM triage (SPEC-2); absent or failing → soft-incomplete. */
  triage?: (findings: Finding[], scope: DiffScopeResult) => Promise<TriageResult>;
  clone(prUrl: string): Promise<string>;
  /** PR unified diff (GitHub `.diff` representation). */
  fetchDiff(prUrl: string): Promise<string>;
  /** Analyzer run over the repo → NDJSON stdout (SPEC-1 §1). */
  runAnalyzer(repoDir: string): Promise<string>;
  /** Posts ONE PR comment. */
  postComment(prUrl: string, body: string): Promise<void>;
  /** Releases the clone dir; runReview calls it in a finally, exactly once per clone. */
  dispose(repoDir: string): Promise<void>;
  /** PoC generation (SPEC-3) — frontier LLM seam; absent → sim skipped. */
  generatePoc?: (reqs: PocRequest[]) => Promise<string>;
  /** Sim harness run (SPEC-3) — container seam; absent → sim skipped. */
  runSim?: (repoDir: string, testSource: string, forkUrl: string) => Promise<SimOutcomeMap>;
}

export interface ReviewResult {
  commented: boolean;
  score: number;
  /** Set iff the analyzer could not produce a complete report — the PR comment says so. */
  incomplete?: string;
}

export class AnalyzerFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzerFailedError";
  }
}

const execFileP = promisify(execFile);
const ANALYZER_IMAGE = "rextor/analyzer";
// Analyzer wall-clock budget; a hang must surface as INCOMPLETE, not block the
// sync webhook handler forever (a SIGKILLed docker run cannot outlive this).
const ANALYZER_TIMEOUT_MS = 150_000;

/**
 * Real analyzer runner: the PR repo is mounted READ-ONLY and analyzed inside a
 * no-network, capability-less, resource-limited container (SPEC-1 invariant 3:
 * PR content is untrusted input — its build config executes, so the walls must
 * hold). A container exit is final and judged strictly (exit 3 → stdout is the
 * incomplete report, normalization owns the reason); only status-less CLI
 * failures (shared-daemon churn, cf. analyzer.contract.test.ts) are retried.
 */
export async function runAnalyzerContainer(repoDir: string): Promise<string> {
  const mount = `${resolve(repoDir)}:/repo:ro`;
  let lastMessage = "docker CLI never completed";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await execFileP(
        "docker",
        [
          "run", "--rm",
          "--network", "none",
          "--cap-drop", "ALL",
          "--security-opt", "no-new-privileges",
          "--memory", "2g",
          "--cpus", "2",
          "-v", mount,
          ANALYZER_IMAGE,
        ],
        { maxBuffer: 32 * 1024 * 1024, timeout: ANALYZER_TIMEOUT_MS, killSignal: "SIGKILL" },
      );
      return stdout;
    } catch (err) {
      const e = err as {
        killed?: boolean; signal?: string | null;
        code?: number | string | null; status?: number | null;
        stdout?: unknown; stderr?: unknown; message?: string;
      };
      if (e?.killed) {
        // Timeout kill: fatal immediately — retrying a hung container just
        // burns 3× the budget before the same INCOMPLETE.
        throw new AnalyzerFailedError(`analyzer timed out after ${ANALYZER_TIMEOUT_MS}ms (SIGKILLed)`);
      }
      // promisified execFile reports the child's exit code as `code` (execSync
      // callsites would see `status`); accept both.
      const exitCode = typeof e?.status === "number" ? e.status : typeof e?.code === "number" ? e.code : undefined;
      if (exitCode !== undefined) {
        if (exitCode === 3) {
          // Contract: exit 3 → stdout is the incomplete report; normalization
          // owns the reason. Empty stdout here would masquerade as a clean
          // pass downstream — never return it (SPEC-1 integrity).
          const stdout = String(e.stdout ?? "");
          if (stdout.trim() === "") {
            throw new AnalyzerFailedError("analyzer exited 3 with no incomplete report on stdout");
          }
          return stdout;
        }
        if (exitCode === 125) {
          // docker CLI could not run the container (daemon churn) — transient,
          // retry; a real container exit is never 125.
          lastMessage = e?.message ?? String(err);
          continue;
        }
        // Bounded: unbounded stderr detail can 422 the INCOMPLETE comment
        // into silence (never-silent beats completeness of detail).
        const detail = String(e.stderr ?? e.message ?? "").trim().slice(0, 300);
        throw new AnalyzerFailedError(`analyzer exited ${exitCode}: ${detail}`);
      }
      lastMessage = e?.message ?? String(err);
    }
  }
  throw new AnalyzerFailedError(
    `docker run never produced a container exit (transient daemon failure): ${lastMessage}`,
  );
}

// Untrusted strings (PR file paths, analyzer stderr echoing PR source) render
// as inert text: raw pipes/newlines would break out of the markdown table or
// forge headings inside the bot's own comment, and unescaped `[link](url)`,
// `![img]`, `@mention` would render live phishing links / fire bot-identity
// notifications (SPEC-1 invariant 3).
const cell = (s: string): string =>
  s.replace(/[|\r\n]+/g, " ").replace(/[[\]!@]/g, (c) => `\\${c}`);

// GitHub's hard comment limit; findings beyond the cap are suppressed, never
// allowed to 422 the whole comment into silence.
const MAX_RENDERED_FINDINGS = 50;

// Presentation order (weight-desc); the weights themselves live in findings.ts.
const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low"];

// The published findings JSON doubles as the attestation payload (SPEC-4):
// it must stay under GitHub's practical comment size or the hash becomes
// unverifiable from the comment alone.
const MAX_FINDINGS_JSON_CHARS = 20_000;

const countOps = (t: TriageResult) => ({
  dedup: t.ops.filter((o) => o.op === "dedup").length,
  reclassify: t.ops.filter((o) => o.op === "reclassify").length,
  add: t.ops.filter((o) => o.op === "add").length,
});

function triageLine(t: TriageResult): string {
  if (t.triageStatus === "complete") {
    const c = countOps(t);
    const rej = t.rejectedOps.length > 0 ? ` · ${t.rejectedOps.length} non-conforming op(s) rejected` : "";
    return `Triaged by \`${cell(t.modelUsed)}\` @ temp 0 · ops: ${c.dedup} dedup · ${c.reclassify} reclassify · ${c.add} added${rej}`;
  }
  if (t.modelUsed !== NO_TRIAGE_MODEL) {
    return `Triage with \`${cell(t.modelUsed)}\` did not complete — raw analyzer findings shown.`;
  }
  return "_LLM triage not configured (set OPENROUTER_API_KEY, REXTOR_TRIAGE_MODEL, REXTOR_FRONTIER_MODEL)._";
}

function findingRow(f: Finding): string {
  const note = f.triageNote
    ?? (f.mergedChecks ? `merged: ${f.mergedChecks.join(", ")}` : "");
  const sev = `${f.severity}${f.poc ? ` [poc:${f.poc.status}]` : ""}`;
  return `| #${f.id ?? "—"} | ${sev} | ${cell(f.check)} | ${cell(f.file)}:${f.line} | ${cell(note)} |`;
}

export function summaryCommentBody(scoreValue: number, triaged: TriageResult, simNote = ""): string {
  const findings = triaged.finalFindings;
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  const rendered = sorted.slice(0, MAX_RENDERED_FINDINGS);
  const hidden = findings.length - rendered.length;
  const banner =
    triaged.triageStatus === "incomplete"
      ? ["**LLM triage unavailable — findings below are raw analyzer output.**", ""]
      : [];
  // The canonical form is published VERBATIM (sha256 of this block is the
  // on-chain findingsHash): untrusted strings stay raw but inert inside the
  // code fence, and the hash stays recomputable by anyone.
  const json = canonicalFindingsJson(findings);
  const jsonBlock =
    json.length > MAX_FINDINGS_JSON_CHARS
      ? [`_(findings JSON omitted: ${json.length} chars exceeds the ${MAX_FINDINGS_JSON_CHARS}-char budget — the attested findingsHash covers the full canonical form)_`]
      : ["```json", json, "```"];
  // Confirmed PoCs render as collapsed runnable blocks. The generated source
  // is DATA (SPEC-3 §4): sanitized (no CR, no 3+ backtick runs) inside a
  // 4-backtick fence so it can never escape into live comment markdown.
  const pocBlocks = findings
    .filter((f) => f.poc?.status === "confirmed" && f.poc.testSource)
    .map((f) => [
      "",
      `<details><summary>Runnable PoC — finding #${f.id} (Foundry)</summary>`,
      "",
      "````solidity",
      sanitizePocSource(f.poc!.testSource!),
      "````",
      "</details>",
    ].join("\n"));
  return [
    `## rextor audit — risk score: ${scoreValue}/100`,
    "",
    ...banner,
    `**${findings.length} finding(s)** in changed contract code.`,
    "",
    "| # | severity | check | location | note |",
    "| --- | --- | --- | --- | --- |",
    ...rendered.map(findingRow),
    ...(hidden > 0 ? ["", `...and ${hidden} more findings suppressed.`] : []),
    "",
    triageLine(triaged),
    ...(simNote ? ["", simNote] : []),
    "",
    "<details><summary>Findings JSON — sha256 of this block = on-chain findingsHash</summary>",
    "",
    ...jsonBlock,
    "",
    "</details>",
    ...pocBlocks,
  ].join("\n");
}

export function incompleteCommentBody(reason: string): string {
  const safeReason = cell(reason.replace(/`/g, "'"));
  return [
    "## rextor audit — INCOMPLETE",
    "",
    "The analyzer could not produce a complete report; no risk score was computed.",
    "",
    `> ${safeReason}`,
    "",
    "_Tool failure is never reported as a clean pass (SPEC-1 integrity)._",
  ].join("\n");
}

export async function runReview(prUrl: string, deps: ReviewDeps): Promise<ReviewResult> {
  const diff = await deps.fetchDiff(prUrl);
  const scope = scopeDiff(diff);
  if (!scope.hasContractChanges) {
    return { commented: false, score: 0 };
  }

  const repoDir = await deps.clone(prUrl);
  try {
    let ndjson: string;
    try {
      ndjson = await deps.runAnalyzer(repoDir);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await deps.postComment(prUrl, incompleteCommentBody(`analyzer failed: ${reason}`));
      return { commented: true, score: 0, incomplete: reason };
    }

    let findings: Finding[];
    try {
      findings = normalizeFindings(ndjson);
    } catch (err) {
      const reason =
        err instanceof IncompleteReportError
          ? err.reason
          : `unparseable analyzer report: ${err instanceof Error ? err.message : String(err)}`;
      await deps.postComment(prUrl, incompleteCommentBody(reason));
      return { commented: true, score: 0, incomplete: reason };
    }

    // SPEC-2 pipeline: analyze → normalize → [triage] → [sim] → score(rubric
    // v1) → ONE PR comment. Triage is soft: a missing or throwing dep degrades
    // to raw findings under the banner, never skips the comment.
    let triaged: TriageResult;
    if (deps.triage) {
      try {
        triaged = await deps.triage(withIds(findings), scope);
      } catch (err) {
        console.error("[rextor] triage dep threw:", err instanceof Error ? err.message : err);
        triaged = rawFindingsResult(withIds(findings));
      }
    } else {
      triaged = rawFindingsResult(withIds(findings));
    }

    // SPEC-3 sim: mutates ONLY `poc` fields (never severities, never
    // existence); an unproven critical then scores 25 via rubric v1. Env is
    // read at call time; missing fork env or seams → skipped, never a
    // pipeline failure.
    const simmed = await runSimStage(triaged.finalFindings, repoDir,
      { generatePoc: deps.generatePoc, runSim: deps.runSim }, process.env);
    const scoreValue = scoreV1(simmed.findings);
    await deps.postComment(prUrl,
      summaryCommentBody(scoreValue, { ...triaged, finalFindings: simmed.findings }, simmed.simNote));
    return { commented: true, score: scoreValue };
  } finally {
    // The clone dir must not outlive the review on any path (token-free but
    // still disk growth); cleanup failure never masks the review result.
    try {
      await deps.dispose(repoDir);
    } catch (err) {
      console.error("[rextor] clone cleanup failed:", err);
    }
  }
}
