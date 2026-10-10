// Comment stage: renders the review outcome into the single PR comment —
// findings table, evidence citations, attestation footer, feedback CTA — plus
// the PR-URL identity used by the reviewId derivation and the server wiring.
// All comment surfaces render untrusted strings inert via cell().
import { scopeDiff, type DiffScopeResult } from "../diff-scope";
import { NO_TRIAGE_MODEL, type TriageResult } from "../triage";
import { sanitizePocSource } from "../sim";
import { canonicalFindingsJson, type Finding, type Severity } from "../findings";
import type { AttestationInfo } from "./types";

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

function findingRow(f: Finding, outsideDiff = false): string {
  const baseNote = f.triageNote
    ?? (f.mergedChecks ? `merged: ${f.mergedChecks.join(", ")}` : "");
  // SPEC-7 §4 — recurrence annotation rides the note column.
  const note = f.learningNote
    ? (baseNote ? `${baseNote} · ${f.learningNote}` : f.learningNote)
    : baseNote;
  const sev = `${f.severity}${f.poc ? ` [poc:${f.poc.status}]` : ""}`;
  const loc = outsideDiff
    ? `${cell(f.file)}:${f.line} *(outside PR diff)*`
    : `${cell(f.file)}:${f.line}`;
  return `| #${f.id ?? "—"} | ${sev} | ${cell(f.check)} | ${loc} | ${cell(note)} |`;
}

// SPEC-7 §3 — quoted cited lines: extracted VERBATIM from the PR diff (never
// LLM-written code). Parses the + side of hunks into per-file (newLine →
// text) maps; path matching uses the shared exact-first/unique-suffix
// convention (matchPath below).
// Path-matching convention shared by evidence citations and scope claims:
// the cited file is matched EXACTLY first, then by a unique "/"-suffix
// (analyzers may report basenames while the diff carries full relative
// paths — an ambiguous suffix matches nothing, and absence renders no
// evidence, never an invention). Line maps are per-file: a multi-file diff
// must not let file B's line 12 answer file A's line 12.
function matchPath<T>(byPath: Map<string, T>, file: string): T | undefined {
  const exact = byPath.get(file);
  if (exact !== undefined) return exact;
  const suffixes = [...byPath.keys()].filter((p) => p.endsWith(`/${file}`));
  return suffixes.length === 1 ? byPath.get(suffixes[0]) : undefined;
}

export function citedLinesFromDiff(
  diff: string,
  file: string,
  line: number,
): Array<[number, string]> | null {
  const byFile = new Map<string, Map<number, string>>();
  let currentFile: string | null = null;
  let lines: Map<number, string> | null = null;
  let newLine = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      currentFile = null;
      lines = null;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      currentFile = p.startsWith('"b/') ? p.slice(3, -1) : p.startsWith("b/") ? p.slice(2) : p;
      lines = byFile.get(currentFile) ?? new Map<number, string>();
      byFile.set(currentFile, lines);
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
    if (lines === null) continue;
    if (raw.startsWith("+")) {
      lines.set(newLine, raw.slice(1));
      newLine += 1;
    } else if (raw.startsWith("-") || raw.startsWith("\\")) {
      // old-side / no-newline marker: absent from the new file
    } else if (raw.startsWith(" ")) {
      lines.set(newLine, raw.slice(1));
      newLine += 1;
    }
    // any other line (e.g. "\ No newline at end of file" handled above) ignored
  }
  const target = matchPath(byFile, file);
  if (!target) return null;
  const window: Array<[number, string]> = [];
  for (let n = line - 1; n <= line + 1; n++) {
    const text = target.get(n);
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
  scope?: DiffScopeResult,
  analyzerNote = "",
): string {
  const findings = triaged.finalFindings;
  // Scope membership (receipts-not-claims): the analyzer audits the WHOLE
  // repo (SPEC-1 §4 — the PR diff is the trigger, not the surface), so the
  // comment must not claim every finding sits in changed code. A finding is
  // "in the PR diff" iff its line falls inside an added-line range of a diff
  // file (exact path first, then unique "/"-suffix — same convention as the
  // evidence sections). Scope comes from the pipeline's own scopeDiff result
  // when available; otherwise it is derived from prDiff. No diff context →
  // membership is unknown → the neutral repo claim, never a changed-code claim.
  const effectiveScope = scope ?? (prDiff !== undefined ? scopeDiff(prDiff) : undefined);
  const scopeMap = new Map(
    effectiveScope?.contractFiles.map((c) => [c.path, c.changedLineRanges]),
  );
  const inChangedCode = (file: string, line: number): boolean =>
    matchPath(scopeMap, file)?.some(([start, end]) => line >= start && line <= end) ?? false;
  const hasScope = scopeMap.size > 0;
  const diffClaim = (() => {
    const n = findings.length;
    if (!hasScope) return `**${n} finding(s)** in the repo's contract code.`;
    const inDiff = findings.filter((f) => inChangedCode(f.file, f.line)).length;
    const outDiff = n - inDiff;
    if (outDiff === 0) return `**${n} finding(s)** in the PR's changed contract code.`;
    if (inDiff === 0) {
      return `**${n} finding(s)** in the repo's contract code — none on lines this PR changes.`;
    }
    return `**${n} finding(s)** — ${inDiff} on lines this PR changes, ${outDiff} elsewhere in the repo (the analyzer audits the repo's contract code; the PR is the trigger).`;
  })();
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
      ? [`> ⚖ attested on ${cell(att.chain)} · ${att.explorerUrl ? `[tx \`${att.txHash.slice(0, 10)}…\`](${att.explorerUrl})` : `tx \`${att.txHash}\``} · verify: recompute sha256 of the findings JSON below and compare with the on-chain findingsHash.`]
      : []),
    "",
    ...banner,
    diffClaim,
    "",
    "| # | severity | check | location | note |",
    "| --- | --- | --- | --- | --- |",
    ...rendered.map((f) => findingRow(f, hasScope && !inChangedCode(f.file, f.line))),
    ...(hidden > 0 ? ["", `...and ${hidden} more findings suppressed.`] : []),
    "",
    triageLine(triaged),
    ...(analyzerNote ? ["", analyzerNote] : []),
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

// Exported for server.ts — the R2 settle wiring derives the repo name for the
// feedback tag2 from the same validated URL the review used.
export function prIdentity(prUrl: string): { repoFullName: string; prNumber: number } {
  const match = prUrl.match(PR_URL_RE);
  if (!match) throw new Error(`not a GitHub PR URL: ${prUrl}`);
  return { repoFullName: `${match[1]}/${match[2]}`, prNumber: Number(match[3]) };
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

// SPEC-7 §3 — the traction loop closes here: every settled review comment asks
// its reader for feedback and points the next user at the install page. The
// sink is a public `audit-feedback` issue on the product repo (zero new
// account for the commenter; testimonials land as consent-gated public social
// proof). Title + review URL prefill via issue-form query params; prUrl is
// registry-validated by PR_URL_RE above and encoded anyway.
export const FEEDBACK_INSTALL_URL = "https://www.rextoraudit.com/install";

export function feedbackCta(prUrl: string): string {
  const { repoFullName, prNumber } = prIdentity(prUrl);
  const query = new URLSearchParams({
    template: "audit-feedback.yml",
    title: `Audit feedback — ${repoFullName}#${prNumber}`,
    review_url: prUrl,
  });
  // Leading "" keeps the `---` blank-line separated: a text line followed
  // directly by `---` renders as a setext H2 in GFM, not a rule.
  return [
    "",
    "---",
    `🩺 **Feedback (30s):** was this review useful, and did it save you time? [Open a public feedback issue](https://github.com/rextorsec/rextor-audit/issues/new?${query.toString()}) — nothing is quoted without your consent.`,
    `**Want this on your repo?** [Install Rextor Audit](${FEEDBACK_INSTALL_URL}) — every PR an audit event.`,
  ].join("\n");
}

// Append the footer — and the feedback/install CTA, so EVERY settled review
// (attested, attestation-skipped, INCOMPLETE, gate-failure) closes the loop.
// prUrl is required: there is no silent-drop path.
export function withFooter(body: string, att: AttestationInfo, findingsHash: string | undefined, prUrl: string): string {
  return [body, ...attestationFooter(att, findingsHash), feedbackCta(prUrl)].join("\n");
}
