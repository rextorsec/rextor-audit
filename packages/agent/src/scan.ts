// Deep Scan — whole-repo scan runner (the post-CWF queued capability): clone
// the repo at a ref (default HEAD), run the analyzer container over the whole
// tree, and return a synchronous report. No diff scoping, no LLM triage, no
// attestation, no PR comment — those gates stay with the PR review pipeline
// and RECTOR. Where the PR pipeline injects decisions, the scan inherits the
// exact semantics runReview uses when triage is absent (rawFindingsResult →
// scoreV1), so a scan's score is recomputable from its published findings
// with the same published rubric.
//
// INCOMPLETE semantics are honored end-to-end: every failure that a PR review
// would surface as an INCOMPLETE comment (clone failure, analyzer crash or
// timeout, unscoped incomplete report, unparseable report) comes back here as
// status 1 with the reason — never a throw past the route, never a silent
// clean pass. Scoped dual-dispatch degradations (SPEC-8 §1) follow runReview:
// the side that scanned clean still scores, the failed side rides the report
// as visible notes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { runAnalyzerContainer } from "./review/analyze";
import {
  parseAnalyzerReport,
  IncompleteReportError,
  incompleteCauseFor,
  scoreV1,
  withIds,
  type Finding,
  type IncompleteCause,
} from "./findings";
import { rawFindingsResult } from "./triage";
import { simTmpBase } from "./sim";

// A hung git transport must not block the synchronous scan request forever
// (same budget discipline as github.ts's clone: SIGKILL, bounded).
const GIT_OPTS = { timeout: 120_000, killSignal: "SIGKILL" as const };

const execFileP = promisify(execFile);

/** Seam for tests; production defaults run real git + the analyzer container. */
export interface ScanDeps {
  /** Git runner seam (test injection); default: real `git` (120s timeout).
   *  Array args only — the ref and URL are argv slots, never a shell string. */
  runGit?: (args: string[]) => Promise<string>;
  /** Token source seam; default: env GITHUB_TOKEN, read at call time. */
  token?: () => string;
  /** Directory-removal seam (test injection); default: rm -rf. */
  rmDir?: (dir: string) => Promise<void>;
  /** Analyzer seam (test injection); default: the real container runner. */
  runAnalyzer?: (repoDir: string) => Promise<string>;
}

/** The synchronous scan report. `status` mirrors the on-chain encoding
 *  (0 = complete, 1 = incomplete); `risk_score` is null on INCOMPLETE (no
 *  score was produced — absent, never faked 0). */
export interface ScanReport {
  repo: string;
  /** The requested ref, exactly as requested ("HEAD" when defaulted). */
  ref: string;
  /** Resolved commit; "" when the clone never got that far. */
  head_sha: string;
  status: 0 | 1;
  risk_score: number | null;
  finding_count: number;
  findings: Finding[];
  /** Set iff status 1 — the reason the report is incomplete. */
  incomplete?: string;
  /** Set iff status 1 — infra-vs-content, classified at the report boundary
   *  (incompleteCauseFor); scans never re-derive it. "infra" = NOT a verdict
   *  on the code; "content" = nothing in scope to analyze. */
  incompleteCause?: IncompleteCause;
  /** SPEC-8 §1 dual-dispatch degradation notes (status stays 0 — the side
   *  that scanned clean still scores, exactly like a PR review's note). */
  degraded?: string[];
}

// POST /scan body validation. Repo must be "owner/name" over the URL-safe
// slug charset — it only ever lands in an HTTPS URL path and a validated
// argv-free execFile array, never a shell. "." / ".." segments are rejected
// on top of the charset so the slug can never walk out of /owner/name.
const SCAN_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Ref must be a safe git ref form: it IS a git argv slot, so a leading "-"
// (option injection), ".." (range syntax), "@{" (reflog syntax), a leading or
// trailing "/" and a ".lock" tail are all rejected before the runner sees it.
const SCAN_REF_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

export function isValidScanRepo(repo: string): boolean {
  if (typeof repo !== "string" || !SCAN_REPO_RE.test(repo)) return false;
  return repo.split("/").every((seg) => seg !== "." && seg !== "..");
}

export function isValidScanRef(ref: string): boolean {
  return (
    typeof ref === "string" &&
    ref.length > 0 &&
    ref.length <= 200 &&
    SCAN_REF_RE.test(ref) &&
    !ref.includes("..") &&
    !ref.includes("@{") &&
    !ref.endsWith(".lock") &&
    !ref.endsWith("/")
  );
}

function requireToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return token;
}

function incompleteReport(
  repo: string,
  ref: string,
  headSha: string,
  reason: string,
  cause: IncompleteCause,
): ScanReport {
  return {
    repo,
    ref,
    head_sha: headSha,
    status: 1,
    risk_score: null,
    finding_count: 0,
    findings: [],
    incomplete: reason,
    incompleteCause: cause,
  };
}

/**
 * Runs one whole-repo scan. Never throws for scan-level outcomes — a clone,
 * analyzer, or parse failure returns an INCOMPLETE report (the route records
 * it); only a misconfigured token seam (GITHUB_TOKEN unset) throws, which is
 * server misconfiguration, not a scan outcome. The clone dir is removed on
 * every path, exactly once.
 */
export async function runScan(repo: string, ref: string | undefined, deps: ScanDeps = {}): Promise<ScanReport> {
  const requestedRef = ref ?? "HEAD";
  const runGit = deps.runGit ?? (async (args: string[]) => (await execFileP("git", args, GIT_OPTS)).stdout);
  const token = deps.token ?? requireToken;
  const rmDir = deps.rmDir ?? ((dir: string) => rm(dir, { recursive: true, force: true }));
  // Same base as the review clone (github.ts): both containers bind-mount the
  // dir, and colima (macOS) shares only $HOME — a /tmp clone mounts as an
  // EMPTY /repo inside the analyzer container.
  const dir = await mkdtemp(join(simTmpBase(), "rextor-scan-"));
  try {
    const [owner, name] = repo.split("/");
    const t = token();
    let headSha = "";
    try {
      // github.ts clone pattern: fetch by URL without registering a remote —
      // the token is an argv slot only and never lands in .git/config.
      const url = `https://x-access-token:${t}@github.com/${owner}/${name}.git`;
      await runGit(["init", dir]);
      await runGit(["-C", dir, "fetch", "--depth", "1", url, requestedRef]);
      await runGit(["-C", dir, "checkout", "--force", "FETCH_HEAD"]);
      // github.ts submodule pattern: foundry repos carry lib/ deps as git
      // submodules; best-effort with a redacted, logged failure — a broken
      // submodule degrades to the analyzer's honest INCOMPLETE, never masks
      // the scan.
      try {
        await runGit(["-C", dir, "submodule", "update", "--init", "--recursive", "--depth", "1"]);
      } catch (subErr) {
        const subDetail =
          subErr instanceof Error ? subErr.message.split(t).join("***") : String(subErr).split(t).join("***");
        console.error(`[rextor] submodule init failed for ${repo}@${requestedRef} (continuing):`, subDetail);
      }
      headSha = (await runGit(["-C", dir, "rev-parse", "HEAD"])).trim();
    } catch (err) {
      // The thrown message must never carry the tokenized URL — redact.
      const detail = err instanceof Error ? err.message.split(t).join("***") : String(err).split(t).join("***");
      const reason = `git clone failed for ${repo}@${requestedRef}: ${detail}`;
      return incompleteReport(repo, requestedRef, "", reason, incompleteCauseFor(reason));
    }

    let ndjson: string;
    try {
      ndjson = await (deps.runAnalyzer ?? runAnalyzerContainer)(dir);
    } catch (err) {
      const reason = `analyzer failed: ${err instanceof Error ? err.message : String(err)}`;
      return incompleteReport(repo, requestedRef, headSha, reason, incompleteCauseFor(reason));
    }

    let findings: Finding[];
    let degraded: string[];
    try {
      const report = parseAnalyzerReport(ndjson);
      findings = report.findings;
      degraded = report.degraded;
    } catch (err) {
      const reason =
        err instanceof IncompleteReportError
          ? err.reason
          : `unparseable analyzer report: ${err instanceof Error ? err.message : String(err)}`;
      // The report boundary classified the incomplete reason (the error
      // carries it); only the unparseable-report fallback classifies here —
      // still through incompleteCauseFor, never hand-derived.
      const cause = err instanceof IncompleteReportError ? err.incompleteCause : incompleteCauseFor(reason);
      return incompleteReport(repo, requestedRef, headSha, reason, cause);
    }

    // Triage-absent semantics, inherited verbatim: raw findings with stable
    // ids under the NO_TRIAGE_MODEL banner, scored by the published rubric —
    // the same path runReview takes when no triage dep is wired. No sim, no
    // reclassification: the scan's score is recomputable from its findings.
    const triaged = rawFindingsResult(withIds(findings));
    const riskScore = scoreV1(triaged.finalFindings);
    return {
      repo,
      ref: requestedRef,
      head_sha: headSha,
      status: 0,
      risk_score: riskScore,
      finding_count: triaged.finalFindings.length,
      findings: triaged.finalFindings,
      ...(degraded.length > 0 ? { degraded } : {}),
    };
  } finally {
    // The clone dir must not outlive the scan on any path; cleanup failure
    // never masks the result.
    try {
      await rmDir(dir);
    } catch (err) {
      console.error("[rextor] scan clone cleanup failed:", err);
    }
  }
}
