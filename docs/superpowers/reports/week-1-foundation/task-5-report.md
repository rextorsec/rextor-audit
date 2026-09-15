# Task 5 Report — Webhook endpoint + PR comment (happy path, local)

**Commit:** `c66cb74` — `feat: webhook + review happy path` (branch `feat/week-1-engine-loop`, on top of `047a3f0`)

## Implementation

### DI design (controller ruling 9)

`runReview(prUrl: string, deps: ReviewDeps)` — all I/O injected via a 4-function context object:

```ts
interface ReviewDeps {
  clone(prUrl: string): Promise<string>;        // PR head checkout → local dir
  fetchDiff(prUrl: string): Promise<string>;    // PR unified diff
  runAnalyzer(repoDir: string): Promise<string>; // NDJSON stdout (SPEC-1 §1)
  postComment(prUrl: string, body: string): Promise<void>;
}
```

- Tests inject fixtures/vault as `clone` result, a fixed `.diff` string, and a recording comment fake. The happy-path and incomplete tests inject only GitHub I/O — the analyzer is the REAL `runAnalyzerContainer` against the REAL fixture through real `scopeDiff` → `normalizeFindings` → `score`.
- `runReview` flow: fetchDiff → scopeDiff → `hasContractChanges === false` → `{commented:false, score:0}` (clone never called, postComment never called) → else clone → runAnalyzer → normalize → score → ONE comment.
- `github.ts` is the thin real adapter (octokit, shallow `git fetch origin pull/N/head`, `mediaType: {format:"diff"}` diff fetch, `issues.createComment`). Tests never import it. Env (`GITHUB_APP_SECRET`, `GITHUB_TOKEN`) is read at call time only.

### INTEGRITY invariant placement (design choice)

Chose "runReview posts the INCOMPLETE comment itself" over "throw for the server to map": the invariant then holds for EVERY caller (server, future CLI, SPEC-2 triage), not just the HTTP path. All three failure modes surface as an INCOMPLETE block with reason and return `{commented:true, score:0, incomplete:reason}`:

1. `runAnalyzer` throws (crash, daemon, non-3 nonzero exit) → `analyzer failed: <msg>`
2. Analyzer exit 3 → stdout parsed by `normalizeFindings` → `IncompleteReportError.reason` verbatim in comment
3. Non-incomplete garbage NDJSON → `unparseable analyzer report: <err>`

Defense-in-depth added in `runAnalyzerContainer`: exit 3 with EMPTY stdout (contract-violating container) throws `AnalyzerFailedError` instead of returning `""` — which would have flowed through normalize as a silent `score: 0` clean pass.

### server.ts

- node:http, no express. Raw body accumulated via `for await` + `Buffer.concat` BEFORE signature verification (HMAC over exact request bytes).
- `verifySignature`: HMAC-SHA256, `sha256=` prefix required, `timingSafeEqual` with length pre-check.
- Routing: no `GITHUB_APP_SECRET` (env read per request) → 500 fail-closed (avoids 401-masquerade from HMAC over `"undefined"`); missing/invalid signature → 401; malformed JSON under valid sig → 400; `pull_request` + opened/synchronize but no `pull_request.html_url` → 400; other events/actions → 200 `{ignored:true}`, zero work.
- `createReviewServer({deps?, secret?})` factory; listening only under the `import.meta.url === pathToFileURL(argv[1])` main-check, so test imports are side-effect free. `scripts.dev` = `tsx --env-file-if-exists=../../.env src/server.ts`.

## TDD evidence

**RED** — tests written first; both modules absent:

```
pnpm exec vitest run test/review.test.ts test/server.test.ts
 FAIL  test/server.test.ts Error: Cannot find module '../src/server'
 Test Files  2 failed (2) | Tests  no tests
```

**GREEN** — after implementation (full suite, verbose confirmed 0 skipped, docker tests really ran):

```
pnpm exec tsc --noEmit   → ok
pnpm exec vitest run
 Test Files  5 passed (5) | Tests  40 passed (40)
 ✓ review.test.ts > happy path (real analyzer container on the vault fixture) > posts exactly one comment carrying the top finding and the score 2366ms
 ✓ review.test.ts > analyzer failure surfaces as an INCOMPLETE comment with the reason (never silent clean) 813ms
```

Happy path pinned: `score > 0`, exactly 1 comment, body contains returned score + `reentrancy-eth` + `high`. Signature vector embedded: body `{"action":"opened","number":42,...}`, secret `rextor-test-secret`, sig `sha256=e4045342…d2ebe` (recompute command in test comment).

**Live smoke** (tsx-run server via `pnpm dev`, port 8461):

| POST | Result |
|---|---|
| signed `push` event | `200 {"ignored":true}` |
| `pull_request.opened`, bad sig | `401 {"error":"invalid signature"}` |
| `pull_request.opened`, valid sig, fake repo | `500` + `[rextor] webhook handler crashed: Error: GITHUB_TOKEN is not set` (correct GitHub boundary) |

## Files changed

- `packages/agent/src/review.ts` — new: ReviewDeps, ReviewResult, AnalyzerFailedError, runAnalyzerContainer, runReview, comment renderers
- `packages/agent/src/server.ts` — new: verifySignature, createReviewServer, webhook routing
- `packages/agent/src/github.ts` — new: real octokit/git/docker adapter
- `packages/agent/test/review.test.ts`, `packages/agent/test/server.test.ts` — new (3 + 14 tests)
- `packages/agent/package.json` — octokit dep, dev script
- `pnpm-lock.yaml`

## Self-review catches (fixed pre-commit)

1. Exit-3-with-empty-stdout would have produced a silent clean pass — now throws.
2. 400 guard originally fired for non-actionable actions (`closed` without URL); now restricted to opened/synchronize missing `pull_request.html_url`.
3. Mid-session, stale-snapshot edits (colliding with `pnpm add`'s package.json rewrite) corrupted package.json/review.ts/server.ts; repaired, then re-verified with a full fresh read + complete suite rerun (40/40 + tsc green post-repair).

## Concerns (for controller)

- `.env` symlink target is 0 bytes — secrets not provisioned; live fail-closed 500 is today's real behavior. No tokens hardcoded anywhere.
- Clone/fetchDiff failures → 500, no PR comment (precondition failures sit outside the INTEGRITY scope; deliberate boundary).
- Webhook processing is synchronous (200 only after review completes) — multi-second responses; queueing is future work. No request-size cap on body accumulation.
- Temp clone dirs accumulate in `$TMPDIR` (deps own lifecycle; no cleanup hook in runReview). Token-in-remote-URL briefly visible in process args — header-based auth is the Week-2 hardening candidate.

---

# Fix-wave report (review round 2) — commit `9ebebfb`

## Per-finding changes

**F1 markdown injection (IMPORTANT)** — `review.ts`: shared `cell()` sanitizer (`s.replace(/[|\r\n]+/g, " ")`) applied to `f.check` + `f.file` in `summaryCommentBody`; `incompleteCommentBody` strips backticks (→ `'`) then applies `cell` to the reason. Untrusted strings render as inert table/quote text — no table breakout, no forged heading line, no fake score block. Tests: evil file `src/evil|Vault.sol\n## rextor audit — risk score: 0` and evil reason (newline + fake score + pipes + backtick) — assertions are LINE-anchored (`not.toContain("\n## rextor audit — risk score: 0")`, heading count `=== 1`): the sanitized cell intentionally still contains the harmless plain TEXT of the attempt inside its cell; what must not exist is the injected line/structure.

**F2 container isolation (IMPORTANT)** —
(a) `runAnalyzerContainer` flags: `--network none --cap-drop ALL --security-opt no-new-privileges --memory 2g --cpus 2` + mount now `:ro`.
(b) Dockerfile: non-root `analyzer` user (uid 1000) as the runtime/ENTRYPOINT user; solc-select cache + foundry toolchain live in its HOME (per-user), so the pip-installed `solc` shim resolves at run time.
(c) Pre-warm layer: throwaway foundry project pinned to `solc_version = "0.8.24"` (both fixtures pin 0.8.24) is `forge build`-ed at image build → svm cache holds the compiler → runtime `forge build` works under `--network none` (verified: build log `Compiling 1 files with Solc 0.8.24 … Compiler run successful!`).
(d) foundryup pinned `-i v1.8.3` (latest release tag at build time, published 2026-09-15); slither 0.11.6 + solc 0.8.24 pins unchanged.
`run.sh` now copies the mounted repo into a writable `mktemp` workdir and analyzes there — a PR's forge build never writes into the (read-only) mount, and works regardless of host-uid vs container-uid.
VERIFY: `docker build --progress=plain -t rextor/analyzer packages/agent/analyzer` → all steps DONE; manual hardened runs: vault → reentrancy-eth/high exit 0; empty dir → exit 3 `no-contract-analyzed`; vault-clean → exit 0 empty stdout. Full contract suite green against the rebuilt image (347/302/288 ms warm).

**F3 token persistence** — `github.ts` clone no longer registers a remote: `git init` → `git fetch --depth 1 <token-url> refs/pull/N/head` → `checkout --force FETCH_HEAD`; token exists only as a CLI argument, never in `.git/config`. `ReviewDeps` gained required `dispose(repoDir)`; `runReview` calls it in a `finally` (exactly once per clone, all paths — success, INCOMPLETE, thrown), guarded so cleanup failure logs but never masks the review result; adapter `dispose` = `rm -rf`. Tests: dispose recorded — docs-only → `[]`; happy + failure paths → `[cloneDir]`.

**F4 timeouts** — docker execFile: `{ timeout: 150_000, killSignal: "SIGKILL" }`; timeout kills are detected (`err.killed`) and throw `AnalyzerFailedError` immediately (no pointless 3× retry of a hung container) → existing catch posts the INCOMPLETE comment. Git calls: `{ timeout: 120_000, killSignal: "SIGKILL" }`. **Bug found during this wave:** promisified `execFile` reports the child's exit code as `error.code`, NOT `status` — exit-3 incomplete reports were being misrouted into the status-less retry path (and the old failure test passed via the crash detour, leaving the normalize path unpinned). Fixed: exit code read from `status ?? code`; classification now 3 → incomplete-report path, 125 → transient daemon churn (retry), anything else → `AnalyzerFailedError`. The docker failure test is tightened to pin `incomplete === "no-contract-analyzed"` so it can only pass through container → NDJSON → `IncompleteReportError` → comment.

**F5 comment size cap** — `MAX_RENDERED_FINDINGS = 50`: findings sorted severity-desc (existing order), top 50 rendered, then `...and N more findings suppressed.` Tests: 1200 synthetic findings → body < 65 000 chars, contains "1150 more findings suppressed" + `check-0`, not `check-50`; a critical among 1200 lows still rendered (severity ordering survives the cap).

**Recommended tests** — both INCOMPLETE catch paths pinned with fake deps (no docker): thrown `Error("slither exploded")` → exactly 1 INCOMPLETE comment containing `analyzer failed: slither exploded`, result `{commented:true, score:0, incomplete:"slither exploded"}`; garbage NDJSON → 1 INCOMPLETE comment, reason prefixed `unparseable analyzer report`.

## Verification commands + outputs

```
docker build --progress=plain -t rextor/analyzer packages/agent/analyzer   → DONE (11 steps)
pnpm exec tsc --noEmit                                                      → ok
pnpm vitest run                                                             → 5 files, 46/46 passed (0 skipped)
  verbose: docker tests really executed vs hardened image (313/242/347/302/288 ms)
manual hardened runs (network none, ro mount): reentrancy high / exit-3 incomplete / clean exit-0
```

## Deferred (ruled Week-2, untouched)
body-size cap on webhook buffering, async queue + dedup, vendored forge-std slimming, commit-message style.

---

# Round-2 fix report (16-lane PR review) — commits c61d8fc · 0ac6e1d · 2b95b12

## Commit 1 — code (c61d8fc)

- **[A] diff-scope adversarial split:** `newPathFromHeader` now walks `lastIndexOf(" b/")` backwards requiring both-sides agreement (`rest.slice(0, idx) === "a/" + bSide`), falling back to the last occurrence (rename case). The silent-skip vector (`contracts/evil b/readme.md` → tail "readme.md" → declassified) is closed. Tests: space path preserved + isContract; adversarial path keeps `hasContractChanges=true` with full path; multi-hunk numbering reset `[[2,2],[22,22]]` pinned.
- **[B] inert markdown objects:** `cell()` additionally escapes `[ ] ! @` (backslash) after pipe/newline collapse — no live `[phish](url)` links, no `![img]`, no bot-identity `@mention` notifications from cells or the INCOMPLETE reason. Tests use regex `(^|[^\\])\[phish\]\(https://e\)` / `(^|[^\\])@ceo` (escaped forms are inert, so assertions check for "no unescaped live sequence").
- **[C]** fatal-exit stderr detail sliced to 300 chars (unbounded detail could 422 the INCOMPLETE comment into silence).
- **[D] token-safe clone hygiene:** `githubDeps` gained DI seams (`runGit`/`token`/`rmDir`); clone wraps init/fetch/checkout — on failure the mkdtemp dir is removed (rm guarded by `.catch`) and the thrown message is `git clone failed for {owner}/{repo}#{number}: <detail with token redacted via split/join>`; deliberately no `cause` chain (Node's inspect prints cause and would leak the tokenized URL to logs). Test: injected fetch failure → dir removed, checkout never ran, message contains no token.
- **[E]** `JSON.parse(rawBody) ?? {}` — signed `null` body → 200 `{ignored:true}` (test added).
- **[F] run.sh contract completeness:** tmpdir-failure and post-parse-crash paths now emit `{"status":"incomplete","reason":"tmpdir-unavailable"|"crash"}` before exit 3 (SPEC-1 §1: exit 3 must never carry empty stdout).
- **[G] test gates:** clean-pass contract test asserts `status === 0` explicitly (exit-3-empty masquerade would fail); retry helper treats `Cannot connect to the Docker daemon` in stderr (numeric status 1) as transient, not a verdict.
- **[H] container self-termination:** ENTRYPOINT is now `timeout -k 5s 140s /usr/local/bin/run.sh` — a hung container dies inside the runner's 150s execFile budget instead of surviving a CLI SIGKILL. Verified `timeout (GNU coreutils) 9.7` present in debian slim; image rebuilt.
- **[I]** `requireNumber` → non-negative integers only (`Number.isInteger(v) && v >= 0`); tests: `line: 1.5` and `line: -3` both throw.
- **[J] wiring:** root `packageManager: pnpm@9.15.9`; agent scripts `test:run` + `typecheck`; `.turbo/` gitignored. Verified from root: `pnpm test:run` runs the real agent suite (uncached proof via `turbo run test:run --force`: 1 task, 0 cached, 54/54) and `pnpm typecheck` runs tsc (1 task successful).

## Commit 2 — fixture (0ac6e1d)

- **[K]** VULN 2 made impactful: owner-gated `rescue()` (require owner; sends `address(this).balance` to owner) — unguarded `setOwner` is now a real drain vector. Verified: `forge test` PASS (`test_reentrancy_drains_vault`, exploit = validity proof); docker contract tests green on the mounted fixture (reentrancy-eth/high still fires; `--fail-none` keeps clean exits with added findings).
- **[L]** `fixtures/vault/PROVENANCE.md`: forge-std = upstream master @ 7fdf81f9ceb2f6ebbb8f9f1c6c5274d5bcc9a1f5 (2026-09-10, `forge install --no-git`); in-tree package.json's 1.16.2 label lags (5 post-tag files). No files touched inside lib/forge-std (byte-identity preserved).

## Commit 3 — docs (2b95b12)

- **[M] PLAN.md:** Phase 4 submission line → "Tempo + Hyperliquid deep; Solana adapter tier; riders config-level"; Phase 2 fork-sim + attestation and Phase 3 identity lines frame liteSVM / Solana attestation / ERC-8004 Solana equivalent as adapter tier gated on Gate B′ (not co-equal in-week); Gate A block notes the Anchor-semantics clause moved to Gate B′ post-pivot; Gate B block labeled `WEAK_PIVOT_EVM_FIRST → EVM-first pivot executed`.
- **[N] SPEC.md:** SPEC-4 row → "(EVM contract; Solana program adapter tier) | planned — EVM-first per Gate B".
- **[O] progress.md:** Ruling 9 added (T5 DI design + runReview posts INCOMPLETE itself); Gate A line cites in-repo evidence `docs/gates/…` + commit 3a0e45a; plumbing line for 7f30459; 047a3f0 chore moved after the Task-4 completion line; stale trailing `## Progress` refreshed (Task 1 record + provenance kept, dead "dispatched next" lines removed); BRANCH COMPLETE line updated (21 commits, 92d62eb..0ac6e1d, 54/54).
- **[P] gate docs:** gate-a — new §6 "CodeRabbit — declared gap (not deep-scanned)" (generic AI PR reviewer, no contract-semantics detector inventory, marked [INFERENCE]/untested gap) + one-line caveat under the moat table ("✗ = not evidenced on public pages at scan time…"); gate-b — "excellent on EVM" softened to "functional and parseable on EVM, auth-detection unproven beyond one micro-fixture", clean-fixture FP-measurement caveat added, `--help` no-language-flag negative result recorded in §3.

## Verification (final battery)

```
docker build -t rextor/analyzer packages/agent/analyzer  → DONE; `timeout (GNU coreutils) 9.7`, uid 1000
pnpm exec turbo run test:run --force (root)              → 1 task, 0 cached, 54/54 tests
pnpm typecheck (root)                                    → 1 task successful
forge test (fixtures/vault)                              → PASS (drain proof intact)
docker contract tests + review tests (vs rebuilt image)  → 13/13 green
```

Deferred per ruling (untouched): noUncheckedIndexedAccess, installer sha256, forge-std re-vendor/slimming, octokit timeouts, body-size cap, async queue/dedup, CONTRACT_PATH_RE depth anchoring, dead exports (stay for SPEC-2/3), commit-boundary style.
