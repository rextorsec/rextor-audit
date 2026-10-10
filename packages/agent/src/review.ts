// SPEC-1 §4 — review runner: fetch diff → scope → analyzer container →
// normalize → score → exactly ONE PR comment. GitHub I/O (clone / diff /
// comment) and the analyzer run are injected as `ReviewDeps` so tests run the
// REAL pipeline with only the I/O faked (controller ruling 9).
//
// Integrity invariant (SPEC-1 cross-cutting #2): an analyzer that cannot
// produce a complete report — crash, timeout, non-report garbage, or the
// contract's `{"status":"incomplete"}` line — surfaces as an INCOMPLETE PR
// comment with the reason. Never a silent clean pass.
//
// The pipeline stages live in review/: analyze.ts (analyzer container exec),
// comment.ts (PR comment rendering + PR identity), types.ts (the
// ReviewDeps/ReviewResult contract). This file keeps the runReview
// orchestration, the github-io stage deadline, the attestation's chain
// helpers, and re-exports the full pre-split public surface unchanged.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scopeDiff, type DiffScopeResult } from "./diff-scope";
import { buildAttestRecord, reviewIdFor, type AttestRecord } from "./attest";
import { resolveChain, attestationChainId, targetChainIdFromFoundry } from "./chains";
import { gateView, rawFindingsResult, type TriageResult } from "./triage";
import { isAnchorRepo, runSimStage } from "./sim";
import {
  parseAnalyzerReport,
  scoreV1,
  withIds,
  IncompleteReportError,
  type Finding,
} from "./findings";
import {
  DEFAULT_CONFIG,
  dismissalKey,
  gateConclusion,
  inScope,
  parseRepoConfig,
  type RepoConfig,
} from "./config";
import { cell, incompleteCommentBody, prIdentity, summaryCommentBody, withFooter } from "./review/comment";
import {
  type AttestationInfo,
  type ReviewDeps,
  type ReviewResult,
  type SolanaVerdictInfo,
} from "./review/types";

export type { Finding } from "./findings";
export type { ReviewDeps } from "./review/types";
export type { ReviewResult } from "./review/types";
export type { SolanaVerdictInfo } from "./review/types";
export { AnalyzerFailedError } from "./review/analyze";
export { runAnalyzerContainer } from "./review/analyze";
export { cell } from "./review/comment";
export { citedLinesFromDiff } from "./review/comment";
export { summaryCommentBody } from "./review/comment";
export { incompleteCommentBody } from "./review/comment";
export { prIdentity } from "./review/comment";
export { FEEDBACK_INSTALL_URL } from "./review/comment";
export { feedbackCta } from "./review/comment";

// Hard deadline for every github-io stage (fetchDiff / postComment /
// readBaseConfig / postCheckRun). A GitHub API call can hang with NO socket
// open (undici connect phase) and evade Octokit's request.timeout — observed
// live: fetchDiff hung 4+ minutes with zero sockets, pinning the ReviewQueue
// slot (and thus every later review) indefinitely. 2× the 15s Octokit budget
// so the normal timeout fires first; this only catches pathological hangs.
// deps.clone is NOT wrapped: the real adapter SIGKILLs git at 120s.
const GITHUB_STAGE_BUDGET_MS = 30_000;

// Races the stage against a one-shot timer; on expiry the stage REJECTS and
// the pipeline's existing catches degrade visibly (INCOMPLETE comment /
// config defaults / logged skip). The losing underlying promise is abandoned:
// Promise.race already holds a handler for it, so a late rejection can never
// surface as unhandledRejection, and the timer is cleared whenever either
// side settles first.
function githubStage<T>(label: string, stage: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not settle within ${githubStageBudgetMs()}ms (hard deadline)`)),
      githubStageBudgetMs(),
    );
  });
  return Promise.race([stage, deadline]).finally(() => clearTimeout(timer));
}

// Budget is read at call time (SPEC-1 env idiom): an env override is an
// ops/test affordance; production default is the 2×-Octokit constant above.
export function githubStageBudgetMs(): number {
  const parsed = Number(process.env.REXTOR_GITHUB_STAGE_BUDGET_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : GITHUB_STAGE_BUDGET_MS;
}

export { GITHUB_STAGE_BUDGET_MS, githubStage };

// Footer label only — resolveChain throws on an unknown chain key; the
// attestation itself never depends on this name, so degrade, never throw.
function activeChainName(): string {
  try {
    return resolveChain(process.env).name;
  } catch {
    return "tempo";
  }
}

// R1 — the primary targetChainId source is the audited repo's own
// foundry.toml. Missing/unreadable file → null (the fallback chain applies);
// attestation can never block or fail the review.
function readFoundryToml(repoDir: string): string | null {
  try {
    return readFileSync(join(repoDir, "foundry.toml"), "utf8");
  } catch {
    return null;
  }
}

export async function runReview(prUrl: string, deps: ReviewDeps): Promise<ReviewResult> {
  // Pre-clone infrastructure failure (dead/hung diff fetch, failed clone): no
  // headSha exists yet, so there is no reviewId to attest, no check-run to
  // update, and no index row to write — the PR comment is the only visible
  // surface, and INCOMPLETE is never silent (SPEC-1 integrity). Best-effort:
  // if that comment cannot be delivered either, the failure stays in the
  // service log and the queue is released regardless.
  let diff: string;
  let scope: DiffScopeResult;
  let repoDir: string;
  let headSha: string;
  try {
    diff = await githubStage("fetchDiff", deps.fetchDiff(prUrl));
    scope = scopeDiff(diff);
    if (!scope.hasContractChanges) {
      return { commented: false, score: 0 };
    }
    ({ dir: repoDir, headSha } = await deps.clone(prUrl));
  } catch (err) {
    const reason = `github setup failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[rextor]", reason);
    try {
      await githubStage("postComment", deps.postComment(prUrl, incompleteCommentBody(reason)));
      return { commented: true, score: 0, incomplete: reason, findings: [] };
    } catch (postErr) {
      console.error("[rextor] failure comment could not be posted:",
        postErr instanceof Error ? postErr.message : postErr);
      return { commented: false, score: 0, incomplete: reason, findings: [] };
    }
  }
  const identity = prIdentity(prUrl);

  // SPEC-7 §1 — base-branch config, loaded once per review. Missing file →
  // defaults (normal case, no note); parse violations → defaults + VISIBLE
  // note in the comment (a half-applied config would make the gate's meaning
  // depend on which lines happened to parse); infrastructure failure (git
  // transport) → defaults, logged — infra is not repo content.
  let repoConfig: RepoConfig = DEFAULT_CONFIG;
  let configError: string | undefined;
  if (deps.readBaseConfig) {
    try {
      const text = await githubStage("readBaseConfig", deps.readBaseConfig(repoDir, prUrl));
      const parsed = parseRepoConfig(text);
      repoConfig = parsed.config;
      configError = parsed.error;
    } catch (err) {
      console.error("[rextor] rextor.yaml read failed (infrastructure):",
        err instanceof Error ? err.message : err);
    }
  }
  const yamlDismissalKeys = new Set(
    repoConfig.dismissals.map((d) => dismissalKey(d.ruleId, d.path)),
  );
  let dismissedKeys = yamlDismissalKeys;
  // SPEC-7 §4 — sync the base-branch yaml into the server-side store (the
  // yaml is the truth; removals propagate), then take the store's key set as
  // the gate input, unioned with yaml keys for the memory-less fallback path.
  if (deps.repoMemory) {
    try {
      deps.repoMemory.syncDismissals(identity.repoFullName, repoConfig.dismissals, headSha);
      dismissedKeys = new Set([
        ...yamlDismissalKeys,
        ...deps.repoMemory.dismissedKeys(identity.repoFullName),
      ]);
    } catch (err) {
      console.error("[rextor] dismissals memory sync failed — yaml keys only:",
        err instanceof Error ? err.message : err);
    }
  }
  // Config errors contain yaml-derived repo content — untrusted text renders
  // inert (same escaping discipline as the findings table).
  const withConfigNote = (body: string): string =>
    configError ? `> ⚠️ ${cell(configError)} — defaults applied.\n\n${body}` : body;

  // SPEC-7 §1 + invariant 24 — check-run conclusion from the severity gate.
  // INCOMPLETE ⇒ neutral (a broken tool is not a code verdict); otherwise the
  // pure gate answers failure|success over the in-scope, dismissal-aware set.
  // Best-effort: a failing check-run never fails the review.
  const checkRunStage = async (
    conclusion: "success" | "failure" | "neutral",
    summary: string,
  ): Promise<void> => {
    if (!deps.postCheckRun) return;
    try {
      await githubStage("postCheckRun", deps.postCheckRun(prUrl, headSha, conclusion, summary));
    } catch (err) {
      console.error("[rextor] check-run post failed:",
        err instanceof Error ? err.message : err);
    }
  };

  // SPEC-6 §3 — review-index write-through: one row per settled review
  // (complete, hard-incomplete, attested or skipped). Absent attestation is
  // stored as empty chain/tx fields — never fake values. Best-effort: the
  // comment has already settled, so an index failure never fails the review.
  const recordIndexRow = (
    riskScore: number,
    findingCount: number,
    incomplete: boolean,
    att: AttestationInfo,
    commentUrl: string | void,
  ): void => {
    if (!deps.recordReview) return;
    try {
      deps.recordReview({
        repo: identity.repoFullName,
        pr: identity.prNumber,
        head_sha: headSha,
        review_id: "reviewId" in att
          ? att.reviewId
          : reviewIdFor(identity.repoFullName, identity.prNumber, headSha),
        chain: "chain" in att ? att.chain : "",
        tx_hash: "txHash" in att ? att.txHash : "",
        explorer_url: "explorerUrl" in att ? att.explorerUrl : "",
        risk_score: riskScore,
        finding_count: findingCount,
        status: incomplete ? 1 : 0,
        comment_url: typeof commentUrl === "string" ? commentUrl : "",
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[rextor] review index write failed:", err instanceof Error ? err.message : err);
    }
  };

  // SPEC-8 §5 — native Solana verdict for Anchor-shaped reviews, chained to a
  // SETTLED home-chain attestation (the native record mirrors an attested
  // verdict; when the home chain skipped, the footer already says why — no
  // second note, no orphan native write). Anchor shape is a REPO-SHAPE branch
  // (same detector as the fork-sim guard), never a chain-name branch. Env-
  // absent → visible skip; a failed write → visible skip; both never fatal.
  const solanaStage = async (record: AttestRecord): Promise<SolanaVerdictInfo | undefined> => {
    if (!isAnchorRepo(repoDir)) return undefined;
    if (!deps.attestSolana) {
      return { skipped: "env unset (REXTOR_SOLANA_PROGRAM_ID / REXTOR_SOLANA_KEYPAIR)" };
    }
    const sol = await deps.attestSolana(record);
    if (!sol) return { skipped: "write failed — agent logs carry the reason" };
    return { txHash: sol.txHash, explorerUrl: sol.explorerUrl };
  };

  // SPEC-4 §3 — attestation runs BEFORE the comment on EVERY verdict path and
  // can never block or fail the review: every failure (no dep, throw, null)
  // degrades to a "skipped" footer. Hard-incomplete reviews attest status=1
  // with the empty findings list — an on-chain riskScore 0 can never
  // masquerade as a clean pass.
  const attestStage = async (
    findings: Finding[],
    riskScore: number,
    incomplete: boolean,
  ): Promise<{ att: AttestationInfo; findingsHash?: string }> => {
    if (!deps.attest) return { att: { skipped: "attestation not configured" } };
    try {
      // SPEC-4 v2 (B3) — pin runs BEFORE attest (score → pin → attest):
      // the record's findingsURI must exist before the write. A pin failure
      // degrades to findingsURI "" — the pin enhances, never blocks.
      let findingsURI = "";
      if (deps.pin) {
        try {
          const pinned = await deps.pin({ commented: true, score: riskScore, findings });
          findingsURI = pinned.uri;
        } catch (err) {
          console.error("[rextor] ipfs pin failed — attesting without findingsURI:",
            err instanceof Error ? err.message : err);
        }
      }
      // SPEC-4 v2 — targetChainId resolves from the SPEC-5 registry chain via
      // the SHARED null-skip helper (same recipe as makeAttestDep); 0 on the
      // record = unresolved (uint32 has no null), the footer skips rendering.
      // R1 — the repo's own foundry.toml chain_id hint is the PRIMARY source
      // (the chain the audited code targets); the home chain is the fallback.
      // PR content is untrusted: only the registry-validated integer crosses
      // into the record — the file text is never rendered or logged.
      let targetChainId = 0;
      try {
        targetChainId =
          targetChainIdFromFoundry(readFoundryToml(repoDir)) ??
          attestationChainId(resolveChain(process.env)) ??
          0;
      } catch { /* unknown chain key — 0 */ }
      const record = buildAttestRecord({
        repoFullName: identity.repoFullName,
        prNumber: identity.prNumber,
        headSha,
        findings,
        riskScore,
        incomplete,
        findingsURI,
        targetChainId,
      });
      const res = await deps.attest(record);
      if (!res) return { att: { skipped: "attestation attempt failed" }, findingsHash: record.findingsHash };
      return {
        att: {
          chain: activeChainName(),
          reviewId: record.reviewId,
          findingsURI: record.findingsURI,
          // R2 — the settle point's feedback dep reads the attested evidence
          // straight off the result; re-deriving the hash could drift.
          findingsHash: record.findingsHash,
          targetChainId: record.targetChainId,
          txHash: res.txHash,
          explorerUrl: res.explorerUrl,
          solanaVerdict: await solanaStage(record),
        },
        findingsHash: record.findingsHash,
      };
    } catch (err) {
      console.error("[rextor] attestation failed:", err instanceof Error ? err.message : err);
      return { att: { skipped: "attestation attempt failed" } };
    }
  };

  try {
    let ndjson: string;
    try {
      ndjson = await deps.runAnalyzer(repoDir);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const { att, findingsHash } = await attestStage([], 0, true);
      const commentUrl = await githubStage("postComment", deps.postComment(prUrl,
        withConfigNote(withFooter(incompleteCommentBody(`analyzer failed: ${reason}`), att, findingsHash, prUrl))));
      await checkRunStage("neutral", `review incomplete: ${cell(reason)}`);
      recordIndexRow(0, 0, true, att, commentUrl);
      return { commented: true, score: 0, incomplete: reason, attestation: att, findings: [] };
    }

    let findings: Finding[];
    let analyzerNote = "";
    try {
      // SPEC-8 §1 — dual dispatch: scoped incompletes degrade to a visible
      // note instead of discarding the side that scanned clean; unscoped
      // incompletes (single-shape repos) still hard-throw INCOMPLETE.
      const report = parseAnalyzerReport(ndjson);
      findings = report.findings;
      if (report.degraded.length > 0) {
        analyzerNote = `_(analyzer: ${cell(report.degraded.join(" · "))} — that side was not scanned)_`;
      }
    } catch (err) {
      const reason =
        err instanceof IncompleteReportError
          ? err.reason
          : `unparseable analyzer report: ${err instanceof Error ? err.message : String(err)}`;
      const { att, findingsHash } = await attestStage([], 0, true);
      const commentUrl = await githubStage("postComment", deps.postComment(prUrl,
        withConfigNote(withFooter(incompleteCommentBody(reason), att, findingsHash, prUrl))));
      await checkRunStage("neutral", `review incomplete: ${cell(reason)}`);
      recordIndexRow(0, 0, true, att, commentUrl);
      return { commented: true, score: 0, incomplete: reason, attestation: att, findings: [] };
    }

    // SPEC-7 §1 paths — one in-scope definition feeds comment, score,
    // attestation payload AND gate alike.
    findings = inScope(findings, repoConfig);

    // SPEC-2 pipeline: analyze → normalize → [triage] → [sim] → score(rubric
    // v1) → ONE PR comment. Triage is soft: a missing or throwing dep degrades
    // to raw findings under the banner, never skips the comment.
    let triaged: TriageResult;
    if (deps.triage) {
      try {
        triaged = await deps.triage(withIds(findings), scope, diff);
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
    // SPEC-7 §4 — learnings ledger: recurrence counts + annotation attach
    // (annotations only; a learning never silences or re-scores a finding).
    if (deps.repoMemory) {
      for (const fnd of simmed.findings) {
        try {
          const { occurrences } = deps.repoMemory.recordOccurrence(
            identity.repoFullName, fnd.check, fnd.file, `${fnd.check}@${fnd.file}:${fnd.line}`,
          );
          if (occurrences >= 2) fnd.learningNote = `rextor ledger: fired ${occurrences}× in this repo`;
        } catch (err) {
          console.error("[rextor] learnings record failed:", err instanceof Error ? err.message : err);
        }
      }
    }
    const scoreValue = scoreV1(simmed.findings);
    const { att, findingsHash } = await attestStage(simmed.findings, scoreValue, false);
    // SPEC-7 §1 enforcement invariant: the gate sees raw ∪ final (gateView) —
    // triage may reshape the comment, never the enforcement decision.
    const conclusion = gateConclusion(gateView(findings, simmed.findings), repoConfig, dismissedKeys);
    // Settled-path comment: the verdict already exists (attested or visibly
    // skipped). A comment failure here must NOT throw the result away — the
    // delivery was ACKed 200 (no reconcile redrive) and a same-id redelivery
    // is deduped, so a thrown result means an attested review that NO surface
    // records. Write the index row regardless and keep the failure visible.
    let commentUrl: string | undefined;
    let commentPosted = false;
    try {
      const posted = await githubStage("postComment", deps.postComment(prUrl, withConfigNote(withFooter(
        summaryCommentBody(scoreValue, { ...triaged, finalFindings: simmed.findings }, simmed.simNote, att, diff, scope, analyzerNote),
        att, findingsHash, prUrl))));
      commentUrl = typeof posted === "string" ? posted : undefined;
      commentPosted = true;
    } catch (err) {
      console.error(
        "[rextor] SETTLED-REVIEW COMMENT LOST (verdict exists; index row written; manual comment redrive needed):",
        `${identity.repoFullName}#${identity.prNumber}@${headSha.slice(0, 10)} —`,
        err instanceof Error ? err.message : err,
      );
    }
    await checkRunStage(conclusion,
      `rextor audit: riskScore ${scoreValue}/100 — severity gate ${conclusion}`);
    recordIndexRow(scoreValue, simmed.findings.length, false, att, commentUrl);
    return { commented: commentPosted, score: scoreValue, attestation: att, findings: simmed.findings };
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
