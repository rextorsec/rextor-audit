// SPEC-1 §4 — review runner: fetch diff → scope → analyzer container →
// normalize → score → exactly ONE PR comment. GitHub I/O (clone / diff /
// comment) and the analyzer run are injected as `ReviewDeps` so tests run the
// REAL pipeline with only the I/O faked (controller ruling 9).
//
// Integrity invariant (SPEC-1 cross-cutting #2): an analyzer that cannot
// produce a complete report — crash, non-report garbage, or the contract's
// `{"status":"incomplete"}` line — surfaces as an INCOMPLETE PR comment with
// the reason. Never a silent clean pass.
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

export interface ReviewDeps {
  /** Shallow-checkout of the PR head → local repo dir (mount source). */
  clone(prUrl: string): Promise<string>;
  /** PR unified diff (GitHub `.diff` representation). */
  fetchDiff(prUrl: string): Promise<string>;
  /** Analyzer run over the repo → NDJSON stdout (SPEC-1 §1). */
  runAnalyzer(repoDir: string): Promise<string>;
  /** Posts ONE PR comment. */
  postComment(prUrl: string, body: string): Promise<void>;
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

/**
 * Real analyzer runner: `docker run --rm -v <repo>:/repo rextor/analyzer`.
 * A container exit is final and judged strictly (exit 3 → stdout is the
 * incomplete report, normalization owns the reason); only status-less CLI
 * failures (shared-daemon churn, cf. analyzer.contract.test.ts) are retried.
 */
export async function runAnalyzerContainer(repoDir: string): Promise<string> {
  const mount = `${resolve(repoDir)}:/repo`;
  let lastMessage = "docker CLI never completed";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await execFileP(
        "docker",
        ["run", "--rm", "-v", mount, ANALYZER_IMAGE],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      return stdout;
    } catch (err) {
      const e = err as { status?: number | null; stdout?: unknown; stderr?: unknown; message?: string };
      if (typeof e?.status === "number") {
        if (e.status === 3) {
          // Contract: exit 3 → stdout is the incomplete report; normalization
          // owns the reason. Empty stdout here would masquerade as a clean
          // pass downstream — never return it (SPEC-1 integrity).
          const stdout = String(e.stdout ?? "");
          if (stdout.trim() === "") {
            throw new AnalyzerFailedError("analyzer exited 3 with no incomplete report on stdout");
          }
          return stdout;
        }
        const detail = String(e.stderr ?? e.message ?? "").trim();
        throw new AnalyzerFailedError(`analyzer exited ${e.status}: ${detail}`);
      }
      lastMessage = e?.message ?? String(err);
    }
  }
  throw new AnalyzerFailedError(
    `docker run never produced a container exit (transient daemon failure): ${lastMessage}`,
  );
}

// Presentation order (weight-desc); the weights themselves live in findings.ts.
const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low"];

export function summaryCommentBody(scoreValue: number, findings: Finding[]): string {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  return [
    `## rextor audit — risk score: ${scoreValue}`,
    "",
    `**${findings.length} finding(s)** in changed contract code.`,
    "",
    "| severity | check | location |",
    "| --- | --- | --- |",
    ...sorted.map((f) => `| ${f.severity} | ${f.check} | ${f.file}:${f.line} |`),
    "",
    "_Deterministic scan, riskScore v0. Findings are starting points, not verdicts._",
  ].join("\n");
}

export function incompleteCommentBody(reason: string): string {
  return [
    "## rextor audit — INCOMPLETE",
    "",
    "The analyzer could not produce a complete report; no risk score was computed.",
    "",
    `> ${reason}`,
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
}
