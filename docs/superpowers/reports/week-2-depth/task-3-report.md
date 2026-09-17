# Task 3 Report: SPEC-2 pipeline integration — triage in runReview + PR comment v1

Commit: `579de92` — `feat: SPEC-2 triage pipeline integration + PR comment v1 (ops trail, banner, findings JSON)`
Branch: `feat/week-2-depth` (on top of 84b651e). Agent suite: **105/105 green**, `tsc --noEmit` clean, repo-root `pnpm test:run` + `pnpm typecheck` green before commit.

## What was implemented

**`packages/agent/src/triage.ts`** (append-only):
- `TriageResult` interface (`finalFindings`/`ops`/`rejectedOps`/`modelUsed`/`triageStatus`), `NO_TRIAGE_MODEL = "none (unconfigured)"`, `rawFindingsResult()` (soft-incomplete passthrough).
- `triageFromEnv(readEnv?, opts?: { fetchFn?: typeof fetch })` — env resolved PER CALL; unset/partial env → `rawFindingsResult` (warn only on partial misconfiguration, silent on fully-unconfigured); `withIds` → `buildCitationUniverse` → `PROFILE_V1_SYSTEM` + `buildTriageUserMessage` → `chatCompletion` → `extractJsonArray` → ONE corrective retry (SPEC-2 §3) → `validateOps` → `applyTriage`. Any transport/parse failure collapses to soft-incomplete with `modelUsed` preserved. `opts.fetchFn` is the transport seam (per brief NOTE) — no global, never live in tests.

**`packages/agent/src/review.ts`**:
- `ReviewDeps` gains optional `triage?: (findings, scope: DiffScopeResult) => Promise<TriageResult>`.
- `summaryCommentBody(scoreValue: number, triaged: TriageResult)` — NEW signature per brief: `risk score: N/100` heading, soft-incomplete banner ("LLM triage unavailable — findings below are raw analyzer output."), findings table with `#`/`note` columns (triageNote, else `merged: …`), ops-trail line (`Triaged by \`model\` @ temp 0 · ops: n dedup · n reclassify · n added · n non-conforming op(s) rejected`), `<details>` block carrying `canonicalFindingsJson` VERBATIM under the 20 000-char budget (omitted note above budget, hash still attested).
- `runReview`: triage inserted between normalize and score — hard-incomplete (analyzer crash / `IncompleteReportError`) still short-circuits BEFORE triage; missing dep or throwing dep → `rawFindingsResult(withIds(findings))` under the banner; comment always posted. Scoring switched `score` (v0) → `scoreV1` (rubric v1) per SPEC-2 "v1 supersedes at the comment". v0 `score()` untouched in findings.ts.

**`packages/agent/src/github.ts`**: default deps object gains `triage: triageFromEnv()` (lazy env read, construct-safe without GITHUB_TOKEN).

**Tests**: new `packages/agent/test/triage-pipeline.test.ts` (9 tests, brief's test code); `review.test.ts` migrated to the new signature; `github.test.ts` +1 test (default deps includes a `triage` function).

## TDD evidence

- **RED**: `cd packages/agent && pnpm vitest run test/triage-pipeline.test.ts` → `Tests 7 failed | 2 passed (9)` — failures exactly `TriageResult`/`rawFindingsResult`/`triageFromEnv` not exported (`TypeError: triageFromEnv is not a function`, missing-export import errors) and old `summaryCommentBody` rendering (missing ops trail / banner). The 2 passing were the pre-existing behaviors (throwing-dep-still-posts, hard-incomplete-before-triage) — correct RED shape.
- **GREEN**: after implementation, agent suite `Test Files 9 passed (9) / Tests 105 passed (105)`; `pnpm typecheck` clean; repo root `pnpm test:run` (turbo, 1 successful task) + `pnpm typecheck` clean.

## Files changed

- `packages/agent/src/triage.ts` (+78)
- `packages/agent/src/review.ts` (+90/−25 region: imports, ReviewDeps, summaryCommentBody v1 + helpers, runReview triage step)
- `packages/agent/src/github.ts` (+5)
- `packages/agent/test/triage-pipeline.test.ts` (new, 187 lines)
- `packages/agent/test/review.test.ts` (+33/−12)
- `packages/agent/test/github.test.ts` (+7)

## Deviations from the brief's literal test code (all sanctioned or forced)

1. **Controller Ruling 1**: `[{ op: "dedup", canonicalId: 0, duplicateIds: [] } as never]` → well-formed `[{ op: "dedup", canonicalId: 0, duplicateIds: [1] }]` with a second finding present (`withIds([finding, { ...finding, check: "reentrancy-no-eth" }])`); added `"1 dedup"` ops-line assertion; `"1 non-conforming op"` expectation unchanged. No type-lie shipped.
2. **Fetch seam** (brief NOTE): `triageFromEnv(readEnv, { fetchFn: fakeFetch(...) })` — the `globalThis.__rextorFetch` global + `@ts-expect-error` dropped.
3. **`expect(body).toContain("LLM triage unavailable") === false`** → `expect(body).not.toContain(...)` — the literal form compares `void` to `false` and fails `tsc --noEmit`; identical semantics (triage completed ⇒ no banner).
4. **Injection test inertness assertions scoped to the rendered markdown** (`body.slice(0, body.indexOf("<details>"))`), and the mention check uses the repo's established guarded regex `(^|[^\\])@owner` (same convention as the existing `@ceo` test). Rationale: the brief's rendering publishes `canonicalFindingsJson` VERBATIM inside the ```json fence (sha256 of that block = findingsHash — sanitizing it would break SPEC-4 attestation, and cell-escaping `\@owner` still substring-matches a bare `/@owner/`). Untrusted strings remain raw but inert inside the fence; the rendered table/triage line stays fully sanitized and the assertions still prove no live link/image/mention there. The existing review.test.ts cell/link tests were updated the same way (assertions scoped to the pre-fence region; heading-line and cap assertions remain whole-body — JSON escapes newlines, so no forged heading line is possible).

## Self-review findings (fixed before commit)

- First implementation pass left a duplicated `normalizeFindings,` import and dropped the `import {` opener of the findings block during edit — caught by the edit tool's parse warning + vitest PARSE_ERROR, repaired, suite re-run green.
- Verified the `score` (v0) import was fully removed from review.ts (no dead import; v0 function itself kept in findings.ts per SPEC-2).
- Confirmed triageFromEnv's catch path returns `rawFindingsResult(withIds(findings))` — the ID-assigned array, so the raw banner shows the same ids the LLM saw.

## Concerns

- Minor (by design per brief): a triage dep that THROWS at the runReview level renders the "LLM triage not configured" line (runReview cannot know the model); the in-dep failure path (triageFromEnv's own catch) correctly renders "Triage with `model` did not complete". Banner + raw findings are correct in both cases.
- The brief's Step 4 estimate said "~30 new tests"; its own test code contains 9 (`+1` github) — I implemented the test code as specified, not the estimate.
