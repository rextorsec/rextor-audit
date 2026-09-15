# SPEC-2 — Rextor Profile v1: Citation-Constrained LLM Triage + riskScore v1

**Series:** [`SPEC.md`](../../SPEC.md) holds the product contract; this is subsystem spec 2 of 6 (see spec index there).
**Status:** ACTIVE — implemented by the Week-2 plan.
**Phase:** Week 2 (Sep 23–29). Builds directly on SPEC-1 (`normalizeFindings` / `IncompleteReportError` / `runReview`).
**Model policy:** OpenRouter, temperature 0. Correctness IS the product — the frontier model is used wherever quality demands it (PoC generation always, SPEC-3; triage escalates on criticals/highs).

## Purpose

Turn raw deterministic findings (Slither + Aderyn via SPEC-1) into a triaged verdict WITHOUT giving the LLM narrative authority: it may reclassify, dedup, or add findings — every op constrained to citations that already exist in deterministic artifacts. The LLM never invents context, never assigns scores, and every deviation from the schema is counted and surfaced.

## Components & contracts

### 1. Triage ops (`packages/agent/src/triage.ts`)

The LLM (and only the LLM) emits a JSON array of ops. Everything else is deterministic TypeScript.

```ts
type TriageOp =
  | { op: "reclassify"; id: number; severity: Severity; reason: string }
  | { op: "dedup"; canonicalId: number; duplicateIds: number[] } // ≥1, distinct, ≠ canonicalId
  | { op: "add"; file: string; line: number; severity: Severity; check: string; description: string };
```

- Findings arrive to triage with stable numeric `id`s assigned in analyzer order (0-based). Ops reference those ids.
- **add** ops get `check` forced to `rextor/<given>` — LLM-added findings are always distinguishable from analyzer-native ones.
- **Citation universe** (what `add` may cite): the union of (a) every deterministic finding's `file`+`line`, (b) every added line of every scoped contract file (`scopeDiff`'s `changedLineRanges`). An `add` outside the universe is rejected. v1 does NOT read repo files to validate — membership in the universe IS the citation proof.
- **Validation** (`validateOps` — pure): unknown id → reject; severity outside the enum → reject; dedup with empty/duplicate/self-referencing ids → reject; add outside the universe or with empty check/description → reject; malformed op shape → reject. Rejected ops are NEVER silently dropped: `rejectedOps: Array<{ op: unknown; reason: string }>` is part of the triage result and rendered in the PR comment ("N non-conforming ops rejected").
- **Application** (`applyTriage` — deterministic): category order dedup → reclassify → add; within a category, array order. Reclassify of an id consumed by dedup → rejected. Dedup removes duplicates; the canonical survives with `mergedChecks: string[]` (the `check` names of everything it absorbed). Reclassify records `triageNote: reason`.

### 2. Triage result, rubric v1, findingsHash (`findings.ts`)

```ts
interface TriageResult {
  finalFindings: Finding[]; // Finding + { id, triageNote?, mergedChecks?, poc? }
  ops: TriageOp[];          // accepted ops only
  rejectedOps: Array<{ op: unknown; reason: string }>;
  modelUsed: string;
  triageStatus: "complete" | "incomplete";
}
```

- **riskScore rubric v1** (published as `docs/rubric.md` when implemented): pure function of the FINAL findings JSON. Weights: critical 60 · high 25 · medium 10 · low 3, cap 100 — with ONE poc-aware rule from SPEC-3: a `critical` whose `poc.status === "unproven"` scores 25 (dynamic evidence against). `confirmed`/`skipped`/absent `poc` keeps 60 — absence of sim evidence never softens a deterministic critical. v0 `score()` remains as the pre-sim function; v1 supersedes it at the comment.
- **findingsHash**: sha256 (hex, 64 chars) over the canonical serialization of the final findings array: UTF-8 JSON, compact separators, object keys sorted lexicographically at every level, array order preserved, and every backtick escaped as `\u0060` (JSON-legal, parses back to the identical string — makes the embedded JSON block backtick-free so it can never break out of the comment's code fence; §4). Recomputable by anyone from the findings JSON published in the PR comment — this is SPEC-4's attestation anchor.

### 3. OpenRouter client (`packages/agent/src/openrouter.ts`)

- `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer $OPENROUTER_API_KEY`.
- Body: `{ model, temperature: 0, max_tokens: 4000, messages }`. System message = the Rextor profile instructions, versioned in `packages/agent/src/profile.ts` (`PROFILE_V1_SYSTEM`). User message = ONLY data: the findings JSON + the citation universe, wrapped in explicit `<untrusted_pr_data>` delimiters, framed as data-never-instructions. (Diff hunks deliberately excluded in v1 — findings + universe carry the triage context; adding raw hunks is a measured v2 decision.)
- Models from env, NEVER hardcoded: `REXTOR_TRIAGE_MODEL`, `REXTOR_FRONTIER_MODEL`. **Escalation rule (deterministic, published):** triage uses the frontier model iff raw findings contain ≥ 1 critical or high. Unset env → triage does not run (soft-incomplete path) — never a guess, never a silent fallback model.
- Response handling: extract the first balanced JSON array from content; on failure retry ONCE with a corrective note ("return ONLY the JSON array"); still failing → soft-incomplete. `AbortController` timeout 90 s per attempt; HTTP error → soft-incomplete. The LLM tier may fail; the review may not.

### 4. Pipeline + comment v1 (`review.ts`)

Insertion between `normalizeFindings` and `score`:

```
analyze → normalize → [triage] → [sim: SPEC-3] → score(rubric v1) → [attest: SPEC-4] → ONE PR comment
```

- **Two incompleteness tiers (binding):**
  - *Hard* (analyzer, SPEC-1): `IncompleteReportError` / `AnalyzerFailedError` short-circuits BEFORE triage — INCOMPLETE comment, no findings, no score. Unchanged.
  - *Soft* (triage, new): triage unavailable/failed → raw deterministic findings ARE posted (withholding them has no integrity value) under a `**LLM triage unavailable — findings below are raw analyzer output**` banner; score computed from raw findings via rubric v1; `triageStatus: "incomplete"`.
- Comment v1 gains: ops trail (dedup merges, reclassifications with reasons, `rextor/` adds), rejected-op count, model line (`triaged by <model> @ temp 0`), banner when soft-incomplete, and a collapsed `<details>` block with the canonical findings JSON — the recomputability artifact (omitted with an explanatory note if > 20 KB). All LLM-touched strings pass through the existing `cell()` sanitizer — LLM output is untrusted for rendering exactly like analyzer output.
- `ReviewDeps` grows: `triage?: (findings: Finding[], scope: Scope) => Promise<TriageResult>` — injected; absent → soft-incomplete. Tests stay offline-deterministic (SPEC-1 invariant 4): the real client is unit-tested behind a mocked `fetch` seam, never live.

## Cross-cutting invariants (SPEC-1 extended)

5. The LLM assigns no score, ever. `score` stays a pure deterministic function of the findings JSON.
6. Every accepted op is id-referenced (reclassify/dedup) or universe-cited (add). Rejected ops are counted and rendered — never dropped silently.
7. Prompt-injection containment: untrusted data reaches the model only inside delimited data blocks; model output reaches the PR only through schema validation + `cell()`; model output is never executed, only parsed.
8. LLM failure degrades the review to soft-incomplete — it can never fabricate a clean pass, and there is no delete op in v1: triage cannot remove information, only merge or annotate it.

## Acceptance

- Pure `validateOps`/`applyTriage` suite: valid ops apply in defined order; each rejection rule fires on a crafted bad op; dedup merges attribution; `rextor/` prefix forced on adds.
- Fake-LLM pipeline test: canned ops → final findings + comment body asserts (ops trail, model line, sanitizer on LLM strings).
- Injection test: LLM-touched strings carrying markdown/link/mention payloads render inert (SPEC-1 sanitizer payload style).
- Soft-incomplete: LLM dep throws / env unset → banner path, raw findings, score from raw.
- Hard-incomplete still short-circuits BEFORE triage (order pinned by test).
- Rubric v1 vectors incl. critical-unproven = 25, critical-skipped = 60, cap 100.
- findingsHash: fixed documented vector; key-order independence (shuffled object keys → same hash).
- OpenRouter client (mocked fetch): temperature 0 + model + bearer on the wire; retry-once on garbage; 90 s abort wiring; escalation selects frontier iff critical/high present.
