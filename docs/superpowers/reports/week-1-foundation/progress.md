# SDD ledger — plan: docs/superpowers/plans/2026-09-15-week-1-foundation.md

**Branch:** `feat/week-1-engine-loop` (from `92d62eb` on main) · **Started:** 2026-09-15
**Spec authority:** `docs/specs/SPEC-1-engine-loop.md` (contracts) — plan argues from it.

## Pre-flight conflict scan

| # | Tasks / surface | One produces ↔ other consumes | Finding |
|---|---|---|---|
| 1 | T1 ↔ T2 | T2 contract test mounts `fixtures/vault` (T1 product) | Consistent; strict order T1 → T2 |
| 2 | T2 ↔ T3/T4 | T2 NDJSON `{file,line,severity,check,description}` + `status:incomplete` exit 3 ↔ T4 `normalizeFindings`/`IncompleteReportError` | Consistent |
| 3 | T3 ↔ T5 | T5 `runReview` consumes `scopeDiff` export | Names consistent across tasks |
| 4 | T1 self | Step-3 test: exploit math (2 ETH drained > 1) checks out EXCEPT stray `payable(address(attacker)).transfer(0);` | **DEFECT** — Ruling 2 |
| 5 | T2 self | `TMP="$(mktemp)"/slither.json` — mktemp without `-d` creates a FILE; `file/slither.json` = ENOTDIR → slither always fails → always `incomplete` | **DEFECT** — Ruling 3 |
| 6 | T2 image | fixture imports forge-std → crytic-compile detects foundry.toml → runs `forge build` → plan's image has no forge → every run `incomplete` | **DEFECT** — Ruling 6 |
| 7 | T2 ↔ T3 | T2 Step 5 runs `pnpm vitest` inside packages/agent — package.json exists only after T3 scaffold | **DEFECT (ordering)** — Ruling 7 |
| 8 | T3 self | Step-2 test has dead ternary `SOL_DIFF.split(...)[1].prepend ? … : <literal>` — `.prepend` undefined → always the literal | Misleading — Ruling 4 |
| 9 | T4 self | Rubric vector 25+25+10=60, cap 100 | Arithmetic ✓ |
| 10 | Global ↔ plan | `INCOMPLETE` semantics, cited `file`+`line`, strict TS, commit prefixes | Matches SPEC-1 invariants |

## Rulings

1. **Workspace:** work in place on `feat/week-1-engine-loop`, not a separate worktree. omp has no native worktree tool; zero concurrent work; AGENTS.md declares branch isolation. Cost if wrong: trivial.
2. **T1 test defect:** DELETE stray `payable(address(attacker)).transfer(0);` (2300-gas transfer → cold BALANCE 2600 → OOG revert → test fails). vm.deal+prank sequence already executes the attack. Applied — confirmed empirically by implementer.
3. **T2 mktemp defect:** `TMP="$(mktemp -d)/slither.json"`.
4. **T3 dead ternary:** implement README-diff case as the plain string literal.
5. **T1 hygiene:** fixtures/vault/.gitignore with `out/` + `cache/` lines.
6. **T2 image defect:** Dockerfile additionally installs Foundry (foundryup). Without it the foundry-project fixture can never analyze → SPEC-1 §1 clean-run contract unreachable. Cost: ~200MB image, +2-4min build — accepted (matches SPEC-1 "real runtimes in Docker", Conatus pattern).
7. **Order:** execute T3 before T2 (T2's vitest step needs T3's scaffold). Plan numbering was authoring order, not dependency order.
- Gate A: **complete** (verdict CONTESTED → positioning sharpened). Evidence: ~/local-dev/.firecrawl/gate-a-competitive-scan-2026-09-15.md; PLAN.md Gate A block + SPEC.md wedge updated (commit on branch).
- Gate B: **complete** (verdict WEAK_PIVOT_EVM_FIRST → EVM-first pivot executed per pre-agreed rule; Tempo flagship, Solana → adapter). Aderyn 0.6.8 = Solidity-only (4 invocation variants, registry-corroborated); joins Slither as 2nd EVM analyzer. Commits c6f4c3c (fixture+evidence), 2304ddd (decision docs: PLAN/SPEC/AGENTS). Evidence archived in docs/gates/.
- Task 3 (plan's T3): implemented at 3e46673 (BASE 2304ddd). DONE_WITH_CONCERNS → concerns adjudicated: **Ruling 8** — brief's `[[14,14]]` internally inconsistent with its own 1-context-line hunk literal (@@ +10,9 @@ → added line = new-file 11); implementer's `[[11,11]]` per SPEC-1 §2 UPHELD (controller re-derived the math). isContract `true` literal per SPEC-1 upheld. Review: T3Review dispatched.
- Repo plumbing: pnpm-lock.yaml committed 25e5b6d (root workspace install; created by controller env setup, not the implementer).
- Task 3 fix round 1/5: 2 addressed, 0 open (commits 3e46673..619757f; re-review ALL_ADDRESSED, no new breakage). **Task 3 complete** (commits 2304ddd..619757f incl. controller lockfile chore 25e5b6d).
- Task 3 deferred minors (for final review): same-file multi-hunk range accumulation untested; octal passthrough = consumers see escaped paths (sanctioned, documented).
- Task 2 (plan's T2): dispatched after T3 per Ruling 7 (BASE 619757f) with Rulings 3 (mktemp -d) + 6 (Foundry in image).
- Task 2 fix round 1/5: 3 addressed (clean-pass regression test + incomplete-marker assert; comment reworded to fail_on=PEDANTIC reality; slither pinned ==0.11.6), 0 open (commits 5b2e61c..b0b1335; re-review ALL_ADDRESSED, retry-masking risk traced clean — numeric-status return precedes retry decisions). **Task 2 complete** (commits 619757f..b0b1335).
- Controller chore dfbe862: @types/node added; tsconfig switched NodeNext→bundler resolution (NodeNext demanded .js import extensions; bundler is idiomatic for vitest+tsx). TSC green + 12/12 vitest green post-change. Note: initial chore commit landed with tsc red (bad `;` in my chain) — amended same concern.
- Task 2 deferred minors (final review): inconsistent json.dumps separators between run.sh incomplete emitters (:6/:26 compact vs :19/:41 spaced) — test pins compact, fails closed; docker-info probe lacks retry under colima churn (silent skip); macOS mktemp not shared into colima VM (behavior-equivalent, documented).
- Task 4 (plan's T4): dispatched (BASE dfbe862).
- Controller chore 047a3f0: { timeout: 180_000 } on the 3 docker-run analyzer tests (T4-reported flake: cold run ~34s vs vitest default 5s). TSC green + 23/23 vitest green after.
- Task 4: **complete** (922a9c6, BASE dfbe862) — review PASS + Approved, ZERO findings (schema-mangled yield, payload complete). No fix loop. Cross-boundary finding-shape match vs Task 2 confirmed by reviewer.
- Task 5 (plan's T5): dispatched (BASE 047a3f0).
- Task 5: **complete** (c66cb74, BASE 047a3f0) — review PASS + Approved (yield schema mangled, payload complete). 40/40 vitest + tsc green + live tsx curl smoke. HMAC vector independently recomputed by reviewer (not tautological); timingSafeEqual used; fail-closed 500 on missing secret.
- Task 5 deferred minors (final review to triage): (1) github.ts:34-36 GITHUB_TOKEN persists in plaintext .git/config of never-removed clone dirs → `git remote remove origin` after fetch; (2) review.ts:62-66 docker execFile lacks timeout → hung container blocks sync handler, bypasses INCOMPLETE via abandonment → timeout 150_000 + killSignal; (3) review.ts:121-128 two INCOMPLETE catch paths (runAnalyzer throws / garbage NDJSON) lack direct tests.
- Week-2 flags (implementer-enumerated, not defects): sync webhook processing, no body-size cap, tmp clone dirs accumulate, .env unprovisioned (fail-closed verified).
- ALL 5 PLAN TASKS COMPLETE. Final whole-branch review next.
- Final whole-branch review: 2 Important + 2 escalated must-fix + size-cap finding (markdown injection; container isolation vs PR-controlled foundry.toml; token persistence; missing timeouts; 65,536-char comment limit). Fix wave 9ebebfb (T5Webhook, one commit): all 5 + 2 recommended tests + bonus catch (promisified execFile error.code routing — exit-3 was misrouted to retry). 46/46 + tsc green, hardened image verified.
- Fix-wave re-review: **ALL_ADDRESSED**, zero new breakage. Residuals ruled Week-2 (octokit timeouts, partial-clone leak on mid-clone throw, token in argv, non-0.8.24 solc pins → INCOMPLETE fail-safe under --network none).
- **BRANCH COMPLETE: 15 commits, 92d62eb..9ebebfb, 46/46 vitest, tsc strict green, all 5 plan tasks + both gates resolved. Integration decision → RECTOR.**

## Environment notes

- forge 1.5.1 ✓ · docker daemon via colima 29.2.0 (running) · pnpm 9.15.9 installed at /opt/homebrew/bin/pnpm (was missing; installed via npm -g).
- No CI workflows yet (fresh repo).

## Progress

- Task 1: **complete** (commits 92d62eb..ac00328, review clean — spec ✅, quality Approved). Implementer also vendored forge-std via `forge install --no-git` (68 files) — accepted ruling: hermetic fixture for container mount, no root .gitmodules.
- Task 1 minors deferred: (a) vendored forge-std carries upstream test/CI/README bulk — slim candidate later; (b) task-1-report.md line-count numbers off slightly (content verified). ⚠️ PASS evidence resolved via reviewer's independent code trace (2-ETH drain).
- Task 3: dispatched next per Ruling 7 (BASE ac00328).
- Gate A scout: running · Gate B aderyn spike: running (no-commit rule).
