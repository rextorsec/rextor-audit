// Review contract types, moved verbatim from review.ts so the stage modules
// (comment.ts) can reference ReviewResult without importing the orchestration
// façade — stage modules must never import review.ts.
import type { Finding, IncompleteCause } from "../findings";
import type { DiffScopeResult } from "../diff-scope";
import type { TriageResult } from "../triage";
import type { PocRequest, SimOutcomeMap } from "../sim";
import type { AttestRecord } from "../attest";
import type { FeedbackDep } from "../feedback";
import type { ReviewRow, RepoMemory } from "../db";

export interface ReviewDeps {
  /** LLM triage (SPEC-2); absent or failing → soft-incomplete. SPEC-7 §2:
   *  receives the raw PR diff as fix-authoring context (prompt-side only). */
  triage?: (findings: Finding[], scope: DiffScopeResult, prDiff?: string) => Promise<TriageResult>;
  /** Clones the PR head; returns the working dir AND the head sha (SPEC-4 §3 —
   *  the attestation record needs the commit identity, and the clone has it locally). */
  clone(prUrl: string): Promise<{ dir: string; headSha: string }>;
  /** PR unified diff (GitHub `.diff` representation). */
  fetchDiff(prUrl: string): Promise<string>;
  /** Analyzer run over the repo → NDJSON stdout (SPEC-1 §1). */
  runAnalyzer(repoDir: string): Promise<string>;
  /** Posts ONE PR comment; resolves the comment html_url when the adapter
   *  can produce it (the review index's comment_url, SPEC-6 §3). */
  postComment(prUrl: string, body: string): Promise<void | string>;
  /** Releases the clone dir; runReview calls it in a finally, exactly once per clone. */
  dispose(repoDir: string): Promise<void>;
  /** PoC generation (SPEC-3) — frontier LLM seam; absent → sim skipped. */
  generatePoc?: (reqs: PocRequest[]) => Promise<string>;
  /** Fork-sim harness run (SPEC-3) — container seam; absent → sim skipped. */
  runSim?: (repoDir: string, testSource: string, forkUrl: string) => Promise<SimOutcomeMap>;
  /** SPEC-4 on-chain attestation; absent or failing → "skipped" footer, comment still posts. */
  attest?: (record: AttestRecord) => Promise<{ txHash: string; explorerUrl: string } | null>;
  /** SPEC-8 §5 — native Solana verdict write to the devnet verdict program for
   *  Anchor-shaped reviews, chained AFTER the home-chain attest settles. Env-
   *  gated (REXTOR_SOLANA_PROGRAM_ID / REXTOR_SOLANA_KEYPAIR); absent or
   *  failing → a VISIBLE skip note in the footer, never a silent pass and
   *  never a review failure. */
  attestSolana?: (record: AttestRecord) => Promise<{ txHash: string; explorerUrl: string } | null>;
  /** SPEC-4 v2 (B3) — IPFS pin of the canonical findings report; runs BEFORE
   *  attest (score → pin → attest → postComment). Absent or throwing → the
   *  attestation proceeds with findingsURI "" (degrade, never block). */
  pin?: (report: ReviewResult) => Promise<{ uri: string; cid: string }>;
  /** SPEC-6 §3 review-index write-through; absent → no row recorded. */
  recordReview?: (row: ReviewRow) => void;
  /** R2 — ERC-8004 reputation feedback. NOT invoked by runReview: the server
   *  fires it fire-and-forget at the settle point (a settled attestation is
   *  the precondition), so it never blocks a review; the drain holds the exit
   *  until broadcasts settle (I1), and hard-incomplete reviews are withheld
   *  (I2). */
  feedback?: FeedbackDep;
  /** SPEC-7 §1 — reads `rextor.yaml` from the PR's BASE branch inside the
   *  clone dir (base-branch config is the only trusted silencing channel,
   *  invariant 21; resolving the base ref is the adapter's job). null = no
   *  config file → defaults. Throwing = infrastructure failure → defaults,
   *  logged (never repo-content errors — those return via parse). */
  readBaseConfig?(repoDir: string, prUrl: string): Promise<string | null>;
  /** SPEC-7 §1 — check-run conclusion from the severity gate. Best-effort:
   *  a failing check-run never fails the review (the comment is the product). */
  postCheckRun?(
    prUrl: string,
    headSha: string,
    conclusion: "success" | "failure" | "neutral",
    summary: string,
  ): Promise<void>;
  /** SPEC-7 §4 — server-side dismissals + learnings (repo-keyed SQLite).
   *  Absent → yaml dismissals alone drive the gate, no annotations. All
   *  memory failures degrade: the review never blocks on the ledger. */
  repoMemory?: RepoMemory;
}

export interface ReviewResult {
  commented: boolean;
  score: number;
  /** Final findings (SPEC-2/3 output) — the canonical-JSON source for the
   *  IPFS pin + findingsHash (SPEC-4 v2 B3). Set on every commented path;
   *  [] on hard-incomplete. Absent when nothing was analyzed. */
  findings?: Finding[];
  /** Set iff the analyzer could not produce a complete report — the PR comment says so. */
  incomplete?: string;
  /** WHY the review went incomplete — stamped on EVERY result that sets
   *  `incomplete`, classified at the report boundary (incompleteCauseFor).
   *  "infra": infrastructure failure (analyzer crash/timeout, clone/GitHub
   *  failure, unparseable report) — NOT a verdict on the code. "content":
   *  the repo had nothing in scope for the analyzer to analyze. */
  incompleteCause?: IncompleteCause;
  /** SPEC-4 §3 — on-chain anchoring outcome; set on every commented path
   *  EXCEPT a pre-clone github-setup failure (no headSha → no reviewId —
   *  nothing to attest; the INCOMPLETE reason carries the failure).
   *  Success shapes when attested, { skipped } when not configured or failed.
   *  findingsHash rides the success shape so the settle point can hand the
   *  EXACT attested evidence to the R2 feedback dep (never re-derived). */
  attestation?:
    | { chain: string; reviewId: string; findingsURI: string; findingsHash?: `0x${string}`; targetChainId: number; txHash: string; explorerUrl: string; solanaVerdict?: SolanaVerdictInfo }
    | { skipped: string };
}

/** SPEC-8 §5 — native Solana verdict outcome, rendered in the footer only for
 *  Anchor-shaped reviews that attested on the home chain. */
export type SolanaVerdictInfo = { txHash: string; explorerUrl: string } | { skipped: string };

/** The attestation outcome shape of ReviewResult. */
export type AttestationInfo = NonNullable<ReviewResult["attestation"]>;
