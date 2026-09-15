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
import { scopeDiff } from "./diff-scope";
import {
  normalizeFindings,
  score,
  IncompleteReportError,
  type Finding,
  type Severity,
} from "./findings";

export type { Finding };

export interface ReviewDeps {
  /** Shallow-checkout of the PR head → local repo dir (mount source). */
  clone(prUrl: string): Promise<string>;
  /** PR unified diff (GitHub `.diff` representation). */
  fetchDiff(prUrl: string): Promise<string>;
  /** Analyzer run over the repo → NDJSON stdout (SPEC-1 §1). */
  runAnalyzer(repoDir: string): Promise<string>;
  /** Posts ONE PR comment. */
  postComment(prUrl: string, body: string): Promise<void>;
  /** Releases the clone dir; runReview calls it in a finally, exactly once per clone. */
  dispose(repoDir: string): Promise<void>;
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

export function summaryCommentBody(scoreValue: number, findings: Finding[]): string {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  const rendered = sorted.slice(0, MAX_RENDERED_FINDINGS);
  const hidden = findings.length - rendered.length;
  return [
    `## rextor audit — risk score: ${scoreValue}`,
    "",
    `**${findings.length} finding(s)** in changed contract code.`,
    "",
    "| severity | check | location |",
    "| --- | --- | --- |",
    ...rendered.map((f) => `| ${f.severity} | ${cell(f.check)} | ${cell(f.file)}:${f.line} |`),
    ...(hidden > 0 ? ["", `...and ${hidden} more findings suppressed.`] : []),
    "",
    "_Deterministic scan, riskScore v0. Findings are starting points, not verdicts._",
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

    const scoreValue = score(findings);
    await deps.postComment(prUrl, summaryCommentBody(scoreValue, findings));
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
