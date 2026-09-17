# SDD ledger — plan: docs/superpowers/plans/2026-09-16-week-2-depth.md

**Branch:** `feat/week-2-depth` (from `f5e22a2` on main) · **Started:** 2026-09-16
**Spec authority:** docs/specs/SPEC-2..5 (ACTIVE) — plan argues from them. SPEC-1 invariants 1-4 bind all tasks.

## Pre-flight conflict scan

| # | Tasks / surface | One produces ↔ other consumes | Finding |
|---|---|---|---|
| 1 | T1 ↔ T3 | T1 triage core (validateOps/applyTriage/buildCitationUniverse/TriageOp) ↔ T3 triageFromEnv + pipeline | Names consistent |
| 2 | T1 ↔ T2 | T1 exports UniverseEntry ↔ T2 buildTriageUserMessage imports it | Consistent |
| 3 | T2 ↔ T3 | T2 transport+prompts ↔ T3 assembly (retry-once, escalation) | Consistent |
| 4 | T3 ↔ T4 ↔ T8 | All three edit runReview + summaryCommentBody; signature evolves T3 (2-arg) → T4 (3-arg, default) → T8 (footer); sequential dispatch, each updates own callers | Consistent, ordered |
| 5 | T3 self | comment test builds `dedup` op with `duplicateIds: []` + `as never` (rendering-only, bypasses validator) | Misleading — Ruling 1 |
| 6 | T4 ↔ T5 | T4 runSim dep signature (repoDir, testSource, forkUrl) ↔ T5 runSimContainer implements it | Consistent |
| 7 | T5 self | forge --json output shape + fixture solc-in-container compile | Implementation-time empirical verification mandated by plan |
| 8 | T6 ↔ T8 | T8 REXTOR_ATTESTATION_ABI ↔ T6 exact signature (bytes32×3, uint16×2, uint8) | Consistent |
| 9 | T7 ↔ T8 | T8 makeAttestDep consumes resolveChain (T7) | Consistent (why T7 precedes T8) |
| 10 | T8 self | clone shape `{dir, headSha}` changes ReviewDeps; T1–T7 fakes keep `Promise<string>` until T8 updates repo-wide | Consistent, ordered |
| 11 | T9 ↔ T3/T8 | queue makes reviews async → existing server tests may assert sync execution | Ruling 2 |
| 12 | T6 self | plan commit command has `contracts/attestation-evum` typo w/ self-correcting comment | Cosmetic — Ruling 3 |
| 13 | T2 self | openrouter.test.ts has duplicate import line from same module | Cosmetic — Ruling 3 |

## Rulings

1. **T3 test cleanup allowed:** the `as never` dedup-op literal in the plan's comment-rendering test may be replaced by a well-formed dedup op; the "1 dedup" count expectation is unchanged. Why: the literal is rendering-fixture-only, not a validator test; a well-formed op tests the same line without a type lie. Cost if wrong: none (test-local).
2. **T9 async semantics (plan amendment, minimal):** the queue change makes reviews async; existing server tests asserting synchronous review execution must be adapted (await drain — expose `ReviewQueue.idle(): Promise<void>` if needed). Why: the plan's T9 did not enumerate the existing-test migration. Cost if wrong: red suite at T9, fixed in-loop.
3. **Cosmetic plan blemishes** (T2 duplicate import line; T6 typo'd example path in the commit command; T6 assertEqUint indentation oddities): implementers follow corrected intent; no plan re-authoring. Cost: none.
4. **Model selection on omp:** the harness `task` tool exposes no per-dispatch model override; all implementers/reviewers inherit the session tier. The skill's model-tier guidance is honored where the harness allows. Cost: higher per-dispatch cost than a tiered setup; no quality loss.

## Environment notes
- docker via colima; `rextor/analyzer` local image; forge 1.5.1; pnpm 9.15.9 at /opt/homebrew/bin; `.env` empty (soft/skip paths exercised by tests).

## Progress
- Task 1 (triage core): dispatched (BASE f5e22a2, implementer job T1TriageCore, brief task-1-brief.md).
- Task 1: complete (commits f5e22a2..6b08523, review clean — 0 critical/important; 85/85 + tsc green; sha256 vector independently recomputed by reviewer, match).
- Task 1 minors (deferred to final review): applyTriage lacks withIds-precondition doc comment; usedAsDup is dead state (removed.has checked first); scaffolding comment shipped in findings.test.ts vector; mid-file second import block in findings.test.ts.
- Task 1 ⚠️ resolutions (controller): TDD RED tally + pre-implementation vector computation are process claims unverifiable from artifacts — accepted: GREEN gate internally consistent, test pins canonical literal AND digest independently, reviewer recomputed digest externally.
- Task 2 (OpenRouter client + prompts): dispatched (BASE 6b08523, implementer job T2OpenRouter, brief task-2-brief.md; rulings 3 carried: merge duplicate import, drop stray binding).
- Task 2: complete (commits 6b08523..84b651e, review Approved — 0 critical/important; 95/95 + tsc green; F1 env-widening + F2 test-literal fix both adjudicated sound by reviewer).
- Task 2 minors (deferred to final review): (1) ⚠️SECURITY-RELEVANT: `</untrusted_pr_data>` literal in finding description escapes the untrusted block (profile.ts:38) — recommend fix-wave inclusion (strip/escape delimiter before embedding + test); (2) abort timer cleared before body read — stalled body outside 90s bound (undici bodyTimeout backstops); (3) transport URL/method unpinned by tests; (4) unparseable-JSON collapse path + real timer wiring untested; (5) extractJsonArray stops at first parse failure (fail-safe) + dead Array.isArray; (6) prompt regression coverage thin (no-delete rule unpinned); (7) triageModelFor param typed Array<{severity:string}> — structural subtype, do NOT "fix" in T3.
- Task 3 (pipeline + comment v1): dispatched (BASE 84b651e, implementer job T3Pipeline, brief task-3-brief.md; Ruling 1 carried: the `as never` dedup-op literal may be replaced by a well-formed op, "1 dedup" expectation unchanged).
- Task 3: complete (commits 84b651e..579de92, review Approved — 0 critical/important; 105/105 + tsc green; all 4 deviations adjudicated sound: Ruling 1 op, fetchFn seam, forced tsc fix, and deviation-4's fence-safety chain verified end-to-end).
- Task 3 minors (deferred): partial-misconfig warn asymmetric (models-set+key-missing silent); no pipeline-level fence-breaker test (description containing ```); withIds-passing unasserted in fake triage; NO_TRIAGE_MODEL sentinel conflates unconfigured with dep-failed (throwing dep renders "not configured" line); console.error noise in throwing-dep test (spyOn would assert logging contract).
- Task 4 (fork-sim core): dispatched (BASE 579de92, implementer job T4SimCore, brief task-4-brief.md).
- Task 4: fix round 1/5 (1 important + 2 minors addressed, 0 open — absent-generator config-gap skip, id-exact shape regex, malformed-outcome guard; commits edd2e15..4c262fa).
- Task 4: complete (commits 579de92..4c262fa, re-review ALL_ADDRESSED, no new breakage; 122/122 + tsc green).
- Task 4 minors (deferred): shape-validation now id-exact (fixed in round 1); PoC blocks render from all findings while table caps at 50 (confirmed-beyond-cap gets block w/o row — whole-branch pass); unproven-critical=25 composition untested at review level; re-review OOS: results guard admits arrays (loose but classified); poc.testSource stores raw source, sanitizePocSource only at render (pre-existing, ledgered).
- Task 5 (sim harness + docker E2E): dispatched (BASE 4c262fa, implementer job T5SimHarness, brief task-5-brief.md; docker daemon verified up).
- Task 5: review verdict Needs fixes — 1 Critical + 2 Important (reviewer yielded null on exit but full report recovered from transcript; probes were throwaway containers, repo untouched).
- Ruling (T5 Critical 1, FFI bypass): accepted as prescribed — fail-closed post-assembly config assertion in sim.sh (`FOUNDRY_FFI=false forge config --json | grep '"ffi": *true' && exit 1` → harness failure → unproven), sed patch kept as hygiene, dotted-key form added to the adversarial test. Spec intent (FFI denied against PR config, adversarially proven) is binding; the env-override LETTER is empirically false on forge 1.8.3 — SPEC-3 §2 errata to follow the fix. Cost if wrong: sim harness fail-closes (unproven) instead of silently allowing vm.ffi — conservative failure mode.
- Ruling (T5 Important 2, decoy same-name contract): REAL and load-bearing — "confirmed" is the product. Fix: pin `--match-path test/RextorPoc.t.sol` (our copied file) to the forge invocation so ONLY the generated file's tests run; parseForgeJson keying stays bare-name (single-source guaranteed upstream). SPEC-3 §2 invocation contract amended accordingly (errata commit to follow). Cost if wrong: none — narrowing execution to our own file.
- Ruling (T5 Important 3, PR-controlled forge-std): REAL. Partial fix accepted in sim.sh style: (a) skip symlinking PR root remappings.txt (seed our own file fresh), (b) bake known-good forge-std into the image, (c) append `forge-std/=<baked>` LAST to our remappings.txt (last-match wins). Residual: PR files still COMPILE (not run); direct-path imports in PR files irrelevant to our generated PoC's imports. Deep adversarial (tampered-assert lib) deferred to final review triage. Cost if wrong: false-confirmations via no-op asserts — mitigated by baked-last remapping winning.
- T5 minors (deferred): block.txt corruption → block 0 instead of throw; parseForgeJson bare throw lacks stderr tail; 240_000 literal duplicated in E2E + SIGKILL leaks anvil container; docker-gated vacuous passes vs it.skip; darwin clone() os.tmpdir() mount degradation (PRE-EXISTING github.ts, fix in final wave — needed for T10 live loop on this Mac).
- Task 5: fix round 1/5 (1 critical + 2 importants + 2 cheap minors addressed, 0 open — resolved-config FFI gate (fail-closed by construction, gate-2 backstops gate-1's empty-emission hole), --match-path decoy isolation + regression, baked forge-std pin w/ checksum-verified provenance + fail-closed resolved-view check; commits 5756307..b94f182).
- Task 5: complete (commits 4c262fa..b94f182, re-review ALL_ADDRESSED; 128 passed/1 skipped + E2E 3 passed + tsc + root green).
- Task 5 re-review new-breakage minor (deferred): gate-refusal reasons echo to container stderr only, not /poc/stderr.txt → upstream sees generic 'no result' without refusal cause (docker logs carry it); one-line fix.
- Task 5 OOS (deferred): slashless-LHS toml remapping 'forge-std=...' survives strip+gate on paper, non-exploitable on pinned toolchain (longest-prefix resolution favors baked); parseInt tolerance on harness-written block.txt.
- Task 6 (attestation contract): dispatched (BASE 2472278, implementer job T6Contract, brief task-6-brief.md).
- Task 6: complete (commits 2472278..a65df42, review Approved — 0 critical/important; forge 10/10 + pnpm green; vendored forge-std byte-identical to fixtures pin; sentinel/short-circuit probes verified_no_defect).
- Task 6 minors (deferred, all plan-mandated edges): setAgentActive on unregistered mints empty-name agent; re-register resets reviewCount (ops caveat for key rotation); different-agent identical-payload no-op keeps original attester; deactivated-agent redelivery reverts NotActiveAgent before idempotency (ops caveat for webhook redelivery + key rotation); local .gitignore redundant w/ root; coverage polish (different-agent no-op, count-reset, zero-payload-vs-unknown verify).
- Task 7 (chain registry): dispatched (BASE a65df42, implementer job T7Chains, brief task-7-brief.md).
- Task 7: fix round 1/5 (1 important + 2 minors addressed, 0 open — Object.hasOwn guard + prototype-key regression tests, deepFreeze registry, rider rows mirror registry text; commits 93cd8b0..432e01c).
- Task 7: complete (commits a65df42..432e01c, re-review ALL_ADDRESSED; 135/1 + tsc green).
- Task 7 OOS ledgered: M2 pending deployments pointers (forward refs, SPEC-4 fills); M4 riders carry mainnet chainIds in testnet.chainId (binding for T8, whole-branch review decides); foundry.toml mismatch warning consciously deferred (log-only v1); deepFreeze skips function values (data-only registry, harmless).
- Task 8 (attestation integration): dispatched (BASE 432e01c, implementer job T8Attest, brief task-8-brief.md; vectors-module + sha256('[]') external-computation carried).
- Task 8: complete (commits 432e01c..0e8bb5b, review Approved — 0 critical/important; 147/1 + root green; clone migration 9/9 fakes verified; hash vectors independently recomputed by reviewer).
- Ruling (T8 env knob): REXTOR_ATTEST_CHAIN from the plan sketch SUPERSEDED by the registry's REXTOR_DEFAULT_CHAIN (one chain knob for the whole engine, SPEC-5 invariant-15 spirit). SPEC-4 §3 errata queued.
- Task 8 minors (deferred): makeAttestDep doc overclaims totality (malformed key / unknown chain throw sync — absorbed by attestStage's catch today); hardcoded nativeCurrency decimals 18 vs Tempo USD 6 (inert, registry should own currency metadata); makeAttestDep internals untested (timeout not injectable; hard-incomplete riskScore 0 unpinned); footer interpolates dep-returned txHash/explorerUrl raw (in-trust-domain, spec-met); reviewId test library-anchored not external-literal.
- Task 9 (webhook hardening): dispatched (BASE 0e8bb5b, implementer job T9Hardening, brief task-9-brief.md; Ruling 2 carried: adapt sync-asserting server tests via idle-drain affordance).
- Task 9: complete (commits 0e8bb5b..b62d716, review Approved — 0 critical/important; 155/1 + root green; dedup-test deadlock fix adjudicated CORRECT; race-free by construction).
- Task 9 minors (deferred): idle() doc overpromises (snapshots tail at call time); as ReviewServer cast polish; TTL expiry branch untested (Date.now spy would work); shutdown drops queued reviews post-200 (self-heals via GitHub redelivery; graceful drain = Week-3).
- ALL 9 PLAN TASKS COMPLETE. Final whole-branch review next.
- Final whole-branch review: verdict WITH FIXES (1 critical delimiter-escape both prompt sites; 1 important darwin clone mount; 1 important gate-refusal stderr; riding minors). Spec drift: CLEAN (both errata reconcile 1:1). Backlog: all consciously deferred (registry-v2 rename ruled). Fix wave dispatched (FIX_BASE e248b2a, job FinalFixWave).
- Final fix wave: complete (commits e248b2a..aceb80c — 3c07ec0 delimiter escape + fence-breaker, 5a49a52 clone base, aceb80c gate stderr + doc path; 161/1 + root green at each commit).
- Final fix-wave re-review: ALL_ADDRESSED, zero new breakage. BRANCH COMPLETE: 17 commits f5e22a2..aceb80c.
