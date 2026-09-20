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
import { buildAttestRecord, reviewIdFor, type AttestRecord } from "./attest";
import type { ReviewRow, RepoMemory } from "./db";
import { resolveChain, attestationChainId } from "./chains";
import { NO_TRIAGE_MODEL, rawFindingsResult, type TriageResult } from "./triage";
import { isAnchorRepo, runSimStage, sanitizePocSource, type PocRequest, type SimOutcomeMap } from "./sim";
import {
  canonicalFindingsJson,
  normalizeFindings,
  scoreV1,
  withIds,
  IncompleteReportError,
  type Finding,
  type Severity,
} from "./findings";
import {
  DEFAULT_CONFIG,
  dismissalKey,
  gateConclusion,
  inScope,
  parseRepoConfig,
  type RepoConfig,
} from "./config";

export type { Finding };

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
  /** SPEC-4 §3 — on-chain anchoring outcome; set on every commented path
   *  EXCEPT a pre-clone github-setup failure (no headSha → no reviewId —
   *  nothing to attest; the INCOMPLETE reason carries the failure).
   *  Success shapes when attested, { skipped } when not configured or failed. */
  attestation?:
    | { chain: string; reviewId: string; findingsURI: string; targetChainId: number; txHash: string; explorerUrl: string; solanaVerdict?: SolanaVerdictInfo }
    | { skipped: string };
}

/** SPEC-8 §5 — native Solana verdict outcome, rendered in the footer only for
 *  Anchor-shaped reviews that attested on the home chain. */
export type SolanaVerdictInfo = { txHash: string; explorerUrl: string } | { skipped: string };

/** The attestation outcome shape of ReviewResult. */
type AttestationInfo = NonNullable<ReviewResult["attestation"]>;

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
      () => reject(new Error(`${label} did not settle within ${GITHUB_STAGE_BUDGET_MS}ms (hard deadline)`)),
      GITHUB_STAGE_BUDGET_MS,
    );
  });
  return Promise.race([stage, deadline]).finally(() => clearTimeout(timer));
}

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
// Exported for chat.ts — same inert-rendering discipline across every comment surface.
export const cell = (s: string): string =>
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
  suggest: t.ops.filter((o) => o.op === "suggest_fix").length,
});

function triageLine(t: TriageResult): string {
  if (t.triageStatus === "complete") {
    const c = countOps(t);
    const rej = t.rejectedOps.length > 0 ? ` · ${t.rejectedOps.length} non-conforming op(s) rejected` : "";
    const sug = c.suggest > 0 ? ` · ${c.suggest} suggest` : "";
    return `Triaged by \`${cell(t.modelUsed)}\` @ temp 0 · ops: ${c.dedup} dedup · ${c.reclassify} reclassify · ${c.add} added${sug}${rej}`;
  }
  if (t.modelUsed !== NO_TRIAGE_MODEL) {
    return `Triage with \`${cell(t.modelUsed)}\` did not complete — raw analyzer findings shown.`;
  }
  return "_LLM triage not configured (set OPENROUTER_API_KEY, REXTOR_TRIAGE_MODEL, REXTOR_FRONTIER_MODEL)._";
}

function findingRow(f: Finding): string {
  const baseNote = f.triageNote
    ?? (f.mergedChecks ? `merged: ${f.mergedChecks.join(", ")}` : "");
  // SPEC-7 §4 — recurrence annotation rides the note column.
  const note = f.learningNote
    ? (baseNote ? `${baseNote} · ${f.learningNote}` : f.learningNote)
    : baseNote;
  const sev = `${f.severity}${f.poc ? ` [poc:${f.poc.status}]` : ""}`;
  return `| #${f.id ?? "—"} | ${sev} | ${cell(f.check)} | ${cell(f.file)}:${f.line} | ${cell(note)} |`;
}

// SPEC-7 §3 — quoted cited lines: extracted VERBATIM from the PR diff (never
// LLM-written code). Parses the + side of hunks into (newLine → text) per
// file; returns a ±1 window around the cited line, or null when the line is
// outside the diff — absence renders no evidence, never an invention.
export function citedLinesFromDiff(
  diff: string,
  file: string,
  line: number,
): Array<[number, string]> | null {
  const byNewLine = new Map<number, string>();
  let currentFile: string | null = null;
  let newLine = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      currentFile = null;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      currentFile = p.startsWith('"b/') ? p.slice(3, -1) : p.startsWith("b/") ? p.slice(2) : p;
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("index ") || raw.startsWith("new file") ||
        raw.startsWith("deleted file") || raw.startsWith("similarity ") || raw.startsWith("rename ")) {
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (currentFile === null) continue;
    if (raw.startsWith("+")) {
      byNewLine.set(newLine, raw.slice(1));
      newLine += 1;
    } else if (raw.startsWith("-") || raw.startsWith("\\")) {
      // old-side / no-newline marker: absent from the new file
    } else if (raw.startsWith(" ")) {
      byNewLine.set(newLine, raw.slice(1));
      newLine += 1;
    }
    // any other line (e.g. "\ No newline at end of file" handled above) ignored
  }
  const window: Array<[number, string]> = [];
  for (let n = line - 1; n <= line + 1; n++) {
    const text = byNewLine.get(n);
    if (text !== undefined) window.push([n, text]);
  }
  return window.length > 0 ? window : null;
}

export function summaryCommentBody(
  scoreValue: number,
  triaged: TriageResult,
  simNote = "",
  att?: AttestationInfo,
  prDiff?: string,
): string {
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
  // SPEC-7 §2 — suggested fixes render as collapsed, INERT diff blocks
  // (suggested-only, never auto-applied; invariant 23). Same sanitization
  // discipline as PoC sources: no CR, no 3+ backtick runs inside a
  // 4-backtick fence, so model output can never escape into live markdown.
  const suggestionBlocks = findings
    .filter((f) => f.suggestedDiff)
    .map((f) => [
      "",
      `<details><summary>Suggestion — review before applying (finding #${f.id})</summary>`,
      "",
      "````diff",
      sanitizePocSource(f.suggestedDiff!),
      "````",
      "</details>",
    ].join("\n"));
  return [
    `## rextor audit — risk score: ${scoreValue}/100`,
    // SPEC-7 §3 — the verdict banner leads with the on-chain anchor and the
    // anyone-can-verify path (the footer carries the full recipe).
    ...(att && "chain" in att
      ? [`> ⚖ attested on ${cell(att.chain)} · [tx \`${att.txHash.slice(0, 10)}…\`](${att.explorerUrl}) · verify: recompute sha256 of the findings JSON below and compare with the on-chain findingsHash.`]
      : []),
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
    "<details><summary>Findings JSON — sha256 of this exact line (no trailing newline) = on-chain findingsHash</summary>",
    "",
    ...jsonBlock,
    "",
    "</details>",
    ...pocBlocks,
    ...suggestionBlocks,
    // SPEC-7 §3 — per-finding verbatim citations from the diff itself, only
    // for the findings actually rendered. Untrusted content: same inert
    // discipline (sanitize inside a 4-backtick fence).
    ...(prDiff
      ? rendered.flatMap((f) => {
          const lines = citedLinesFromDiff(prDiff, f.file, f.line);
          if (!lines) return [];
          return [
            "",
            `### Evidence — finding #${f.id} (${cell(f.check)} @ ${cell(f.file)}:${f.line})`,
            "````",
            ...lines.map(([n, text]) => sanitizePocSource(`${n} | ${text}`.slice(0, 180)).trimEnd()),
            "````",
          ];
        })
      : []),
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

// SPEC-4 §3 — PR identity for the reviewId derivation. Mirrors github.ts's
// PR_URL_RE (a shared import would make review.ts ↔ github.ts a runtime cycle).
const PR_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/;

function prIdentity(prUrl: string): { repoFullName: string; prNumber: number } {
  const match = prUrl.match(PR_URL_RE);
  if (!match) throw new Error(`not a GitHub PR URL: ${prUrl}`);
  return { repoFullName: `${match[1]}/${match[2]}`, prNumber: Number(match[3]) };
}

// Footer label only — resolveChain throws on an unknown chain key; the
// attestation itself never depends on this name, so degrade, never throw.
function activeChainName(): string {
  try {
    return resolveChain(process.env).name;
  } catch {
    return "tempo";
  }
}

// SPEC-4 v2 — targetChainId: the chain the audited code targets, per the SPEC-5
// registry the engine is pointed at. 0 = unresolved (degraded, shown as-is);
// resolveChain throws on an unknown chain key, so degrade exactly like the name.

// The comment footer (SPEC-4 §3, v2): chain, reviewId, targetChainId, tx/explorer
// link and the findingsHash — the reproducibility recipe sitting next to the
// <details> findings JSON it hashes. findingsURI renders only when non-empty
// ("" = degraded mode — B3 wires IPFS pinning). reviewId recipe is UNCHANGED;
// targetChainId is its own field, never folded into the identity derivation.
// Free-text interpolations (chain name, skip reason) pass through cell();
// reviewId/txHash/findingsHash are agent-generated hex.
// SPEC-4 v2 — the record's targetChainId 0 = unresolved (SPEC-5 null-skip
// semantic): the footer SKIPS the segment rather than printing 0. Same rule
// as uriPart ("" = degraded, omitted).
function attestationFooter(att: AttestationInfo, findingsHash?: string): string[] {
  if ("skipped" in att) return ["", `_attestation skipped: ${cell(att.skipped)}_`];
  const link = att.explorerUrl
    ? `[tx \`${att.txHash.slice(0, 10)}…\`](${att.explorerUrl})`
    : `tx \`${att.txHash}\``;
  const hashPart = findingsHash ? ` · findingsHash \`${findingsHash}\`` : "";
  const chainIdPart = att.targetChainId ? ` · targetChainId \`${att.targetChainId}\`` : "";
  const uriPart = att.findingsURI ? ` · findingsURI \`${att.findingsURI}\`` : "";
  const lines = [
    "",
    "---",
    `⚖ attested on ${cell(att.chain)} · reviewId \`${att.reviewId}\`${hashPart}${chainIdPart}${uriPart} · ${link}`,
  ];
  // SPEC-8 §5 — the native verdict receipt (or its visible skip) sits directly
  // under the home-chain attestation it chained to. Reasons are agent-generated
  // static strings; cell() keeps the inert-rendering discipline uniform.
  if (att.solanaVerdict) {
    if ("txHash" in att.solanaVerdict) {
      const solLink = att.solanaVerdict.explorerUrl
        ? `[tx \`${att.solanaVerdict.txHash.slice(0, 10)}…\`](${att.solanaVerdict.explorerUrl})`
        : `tx \`${att.solanaVerdict.txHash}\``;
      lines.push(`⛓ solana verdict (devnet) · ${solLink}`);
    } else {
      lines.push(`_⛓ solana verdict skipped: ${cell(att.solanaVerdict.skipped)}_`);
    }
  }
  return lines;
}

// Append the footer to a comment body (footer's first row is a blank line).
function withFooter(body: string, att: AttestationInfo, findingsHash?: string): string {
  return [body, ...attestationFooter(att, findingsHash)].join("\n");
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
      let targetChainId = 0;
      try {
        targetChainId = attestationChainId(resolveChain(process.env)) ?? 0;
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
        withConfigNote(withFooter(incompleteCommentBody(`analyzer failed: ${reason}`), att, findingsHash))));
      await checkRunStage("neutral", `review incomplete: ${reason}`);
      recordIndexRow(0, 0, true, att, commentUrl);
      return { commented: true, score: 0, incomplete: reason, attestation: att, findings: [] };
    }

    let findings: Finding[];
    try {
      findings = normalizeFindings(ndjson);
    } catch (err) {
      const reason =
        err instanceof IncompleteReportError
          ? err.reason
          : `unparseable analyzer report: ${err instanceof Error ? err.message : String(err)}`;
      const { att, findingsHash } = await attestStage([], 0, true);
      const commentUrl = await githubStage("postComment", deps.postComment(prUrl,
        withConfigNote(withFooter(incompleteCommentBody(reason), att, findingsHash))));
      await checkRunStage("neutral", `review incomplete: ${reason}`);
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
    const conclusion = gateConclusion(simmed.findings, repoConfig, dismissedKeys);
    const commentUrl = await githubStage("postComment", deps.postComment(prUrl, withConfigNote(withFooter(
      summaryCommentBody(scoreValue, { ...triaged, finalFindings: simmed.findings }, simmed.simNote, att, diff),
      att, findingsHash))));
    await checkRunStage(conclusion,
      `rextor audit: riskScore ${scoreValue}/100 — severity gate ${conclusion}`);
    recordIndexRow(scoreValue, simmed.findings.length, false, att, commentUrl);
    return { commented: true, score: scoreValue, attestation: att, findings: simmed.findings };
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
