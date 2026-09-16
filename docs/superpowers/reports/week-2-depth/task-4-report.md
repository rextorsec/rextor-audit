# Task 4 Report — SPEC-3 fork-sim core

**Commit:** `edd2e15` — `feat: SPEC-3 fork-sim core — PoC seam, result mapping, runnable-PoC comment blocks` (branch `feat/week-2-depth`, on top of `579de92`)
**Status:** DONE (with noted deviations, all test-contract-driven; see "Deviations")

## What was implemented

### `packages/agent/src/sim.ts` (new)
- `simEligible(f)` — critical/high only.
- `readExcerpt(repoDir, file, line, context = 20)` — numbered ±context lines, `${file} (lines from-to)` header; missing source → `${file} (source unavailable)` placeholder, never throws.
- `sanitizePocSource(src)` — strips `\r`, collapses any 3+ backtick run to one (fence-escape defense, SPEC-3 §4).
- `runSimStage(findings, repoDir, { generatePoc?, runSim? }, env)` — the mapping core:
  - No eligible findings → unchanged copies, empty note.
  - No `REXTOR_FORK_RPC_URL` → all eligible `skipped`, note "Fork-sim skipped: no fork configured (REXTOR_FORK_RPC_URL)."
  - Neither dep wired → all eligible `skipped`, note "Fork-sim skipped: sim not configured on this runner."
  - Generation throw → all eligible `unproven` (a sim RESULT, never a pipeline failure), logged via `console.error`.
  - Harness throw → all eligible `unproven`.
  - Outcome map: `results[testRextorPoc_<id>] === true` → `confirmed` with exact `testSource` + `block`; `false`/missing → `unproven` with `block`. Note: `Fork-sim: block N · X confirmed · Y unproven.`
  - Copies findings (`map(f => ({...f}))`) — mutates ONLY `poc`, never severities/existence (SPEC-3 invariant 9).
- `generatePocFromEnv(readEnv?, { fetchFn? })` — frontier-only generation (SPEC-3 §1): POC_V1_SYSTEM + user message with `<untrusted_pr_data>` wrapping (findings/excerpts as DATA, never instructions); strips markdown fences; validates shape (`contract RextorPocTest` + every `testRextorPoc_<id>` present) and rejects otherwise; env re-read per call.

### `packages/agent/src/review.ts` (modified)
- `ReviewDeps` gains `generatePoc?` / `runSim?` (real imports of `PocRequest`/`SimOutcomeMap`).
- `runReview` success path: after triage, `runSimStage(triaged.finalFindings, repoDir, {generatePoc, runSim}, process.env)` → `scoreV1(simmed.findings)` → `summaryCommentBody(score, {...triaged, finalFindings}, simNote)`.
- `summaryCommentBody(scoreValue, triaged, simNote = "")`: sim note as its own line after `triageLine`; `findingRow` severity cell becomes `${severity}${poc ? ` [poc:${status}]` : ""}`; after the findings-JSON details block, per-confirmed `<details><summary>Runnable PoC — finding #<id> (Foundry)</summary>` blocks with `sanitizePocSource` inside a 4-backtick `````solidity fence.

### Tests
- `packages/agent/test/sim.test.ts` (new) — brief's 13 tests verbatim (one path fix, below).
- `packages/agent/test/review.test.ts` — new `runReview sim integration (SPEC-3)` describe, fakeDeps pattern from triage-pipeline.test.ts; `vi.stubEnv("REXTOR_FORK_RPC_URL", …)` + `afterEach(vi.unstubAllEnvs)` because `runReview` reads `process.env` at call time (hermetic on any runner).

## TDD evidence

**RED** — `cd packages/agent && pnpm vitest run test/sim.test.ts test/review.test.ts`:
```
FAIL  test/sim.test.ts — Error: Cannot find module '../src/sim'
× attaches a runnable PoC block… — expected '…risk score: 60/100…' to contain '[poc:confirmed]'
× skipped sim (no env)…        — expected '…' to contain 'Fork-sim skipped: no fork configured'
Tests  2 failed | 10 passed (12)
```

**GREEN** — `pnpm vitest run && pnpm typecheck` (packages/agent):
```
Test Files  10 passed (10)   Tests  119 passed (119)
tsc --noEmit → OK
```
Root: `pnpm test:run && pnpm typecheck` → all turbo tasks successful.

## Files changed
- `packages/agent/src/sim.ts` (new, 141 lines)
- `packages/agent/test/sim.test.ts` (new)
- `packages/agent/src/review.ts` (+36/−7)
- `packages/agent/test/review.test.ts` (+2 tests, imports)

## Self-review findings (fixed before commit)
1. Initial `ReviewDeps` insert orphaned the `dispose` doc comment — member order corrected.
2. Auto-repair dropped a blank line before `summaryCommentBody` — restored.
3. Verified score expectations against `scoreV1` (T1, untouched): critical confirmed=60, skipped=60; unproven critical=25 path exists but is exercised by sim-level tests via mapping (rubric pinned in T1's suite).

## Deviations from the brief (test contracts won; flagged for review)
1. **Fixture path**: brief's `join(__dirname, "../../fixtures/vault")` resolves to `packages/fixtures/vault` (nonexistent); fixtures live at the repo root (per review.test.ts's documented resolution). Used `../../../fixtures/vault`. `__dirname` works in vitest 5 (vite-node provides it) — verified by the passing fixture test.
2. **`generatePocFromEnv` unset-env behavior**: brief's sketch always returned the closure, but the brief's own test requires `undefined` on unset env. Implemented: factory reads env once to decide wiring (undefined vs closure); the closure re-reads env per call (call-time semantics preserved; mid-flight env loss → generation failure → unproven).
3. **deps-missing ordering**: brief's sketch checked `!generatePoc || !runSim → skipped` before generation, which contradicts its own test 4 (`{ generatePoc: boom }` with no runSim → must be **unproven**). Reconciled order: no-fork skip → both-deps-missing skip → generation (throw → unproven) → runSim-missing skip → harness (throw → unproven). This also preserves the brief's production statement: the T5 gap (generatePoc wired, runSim absent) still yields the "not configured on this runner" skip, without rubric damage.
4. **`github.ts` not touched**: brief body mentions `generatePoc: generatePocFromEnv()` in default deps, but the Files list and the Step-5 commit manifest (`git add …`) exclude github.ts. Left unwired — `generatePocFromEnv` is exported and ready; T5 wires it alongside the real `runSim`. Production sim stays fully skipped (note line) until then.

## Concerns
- The review-level "skipped" test stubs env to `""` (falsy = unset) — deterministic; no reliance on runner env.
- `runSimStage` unproven-on-unproven note wording ("harness failed") is logged, not asserted — free to adjust in T5 if the container runner wants richer reasons.
- Nothing else. No docker code written (T5's scope). No AI attribution in the commit (global GPG, repo convention).

## Fix round 1 (controller review of edd2e15)

**Commit:** `4c262fa` — `fix: SPEC-3 sim — absent generator is a config-gap skip, not unproven; id-exact shape match; malformed-outcome guard`

### Important (fixed)
- **Absent generator + present harness → skipped, not unproven.** `runSimStage` now folds `!deps.generatePoc` into the PRE-generation skip (all eligible → `skipped` + "sim not configured on this runner" note). A runner config gap can no longer silently downgrade criticals to rubric-25 unproven. The POST-generation `!deps.runSim` check is unchanged (brief's T5-gap skip preserved), and generator-present-and-throwing still → `unproven` (sim result).

### Minors (both fixed — trivial while in file)
- **Id-exact shape validation:** generated-source check uses `\btestRextorPoc_<id>\b` word-boundary regexes, so finding #1's test fn is no longer "satisfied" by `testRextorPoc_10`.
- **Malformed harness outcome guard:** a null/garbage resolve from the `runSim` seam → `unproven` with the harness-failed note (never-throw is now total; previously `outcome.results` access could escape `runSimStage`).

### Tests added (regression, sim.test.ts)
1. `generator absent but harness present → config-gap skip, never unproven` — fails pre-fix (status was `unproven`), passes post-fix (`skipped` + note).
2. `malformed harness result → unproven, never a throw` — null-resolving `runSim` seam.
3. `shape validation is id-exact: testRextorPoc_1 is not satisfied by _10` — rejects where the old substring check accepted.

### Commands + output
- `cd packages/agent && pnpm vitest run && pnpm typecheck` → **Test Files 10 passed (10), Tests 122 passed (122)** (119 + 3 new); `tsc --noEmit` clean.
- Repo root `pnpm test:run && pnpm typecheck` → all turbo tasks successful.
- Review integration tests (`runReview sim integration (SPEC-3)`) re-ran green within the same suite.

### Files changed
- `packages/agent/src/sim.ts` (skip-condition fold, outcome guard, regex shape match)
- `packages/agent/test/sim.test.ts` (3 regression tests)

No concerns from this round; behavior is config-gap→skip / result→unproven exactly as ruled.
