# Final-Fix Wave Report — feat/week-2-depth (HEAD was e248b2a)

Date: 2026-09-16 · Scope: the four pre-scoped whole-branch-review findings, verbatim prescriptions, no scope creep.

## Result

| Commit | Finding | Subject |
| --- | --- | --- |
| `3c07ec0` | Fix 1 + 4b | fix: escape untrusted-data delimiters in both LLM prompt payloads |
| `5a49a52` | Fix 2 | fix: clone review worktrees under the daemon-bindable tmp base |
| `aceb80c` | Fix 3 + 4a | fix: surface sim gate refusals in /poc/stderr.txt; correct attestation doc path |

All commits GPG-signed from global config (`git log --format='%G?'` → `G G G`), zero AI attribution. Working tree clean. Contracts untouched (forge 10/10 not re-run — out of wave scope, no contract file touched).

## Fix 1 — delimiter escape (both prompt sites) + 4b fence-breaker

- `packages/agent/src/profile.ts`: new exported `escapeUntrustedDelimiters(payload)` — `.replaceAll('</untrusted_pr_data', '<\\/untrusted_pr_data')` **and** the opening tag. `\/` is JSON-legal and string-identical after `JSON.parse`, so hash/citation semantics are untouched. Doc comment pins it PROMPT-PAYLOAD-ONLY: never applied to `canonicalFindingsJson` or any hashed/rendered artifact (SPEC integrity).
- Applied at `buildTriageUserMessage` (profile.ts) and the PoC user message (sim.ts, which already imports from profile — no cycle). The sim payload's `JSON.stringify` includes the raw excerpt channel, so one wrap covers descriptions + excerpts (display/prompt data, never hashed).
- Tests:
  - `test/openrouter.test.ts` — PR description containing the literal closing tag: builder's own delimiters stay a single real pair (`split` count = 2 each), payload copy is escaped, no unescaped injection copy, and the block between the REAL delimiters `JSON.parse` round-trips byte-identical to the original findings + universe. Opening-tag case covered too.
  - `test/sim.test.ts` — same invariants at the PoC site, injection riding the **excerpt** (raw repo text), captured from the outgoing request body via injected `fetchFn`; round-trip asserted on `payload[0].excerpt`.
  - 4b `test/review.test.ts` — pipeline-level fence-breaker: a description containing a ``` ``` ``` run through `summaryCommentBody` → exactly one ` ```json ` opener, the first fence terminator after it is the block's own closer, and the extracted canonical JSON `JSON.parse` round-trips the finding verbatim (`\u0060` backtick escape is what keeps the fence paired — the test fails if that regresses).

## Fix 2 — darwin clone mount base

- `packages/agent/src/github.ts`: clone dir now `mkdtemp(join(simTmpBase(), "rextor-review-"))` (helper reused from sim.ts — github.ts already imports from sim, no cycle). `node:os` `tmpdir` import removed. Comment documents that BOTH container mounts consume `repoDir`, and that `REXTOR_SIM_TMP_DIR` remains the single override knob for clone + sim overlay alike (no new `REXTOR_REVIEW_TMP_DIR` alias — one knob, documented).
- Tests (`test/github.test.ts`): clone dir sits directly under `simTmpBase() + sep`; `vi.stubEnv("REXTOR_SIM_TMP_DIR", …)` moves the clone base with it. No docker spawned; clone dirs disposed.

## Fix 3 — gate-refusal visibility + 4a docs path

- `packages/agent/analyzer/sim.sh`: both fail-closed gate bodies now write their reason to `/poc/stderr.txt` (`|| true`) one line before `exit 1`. Zero runner-side changes, as prescribed.
- Test (`test/sim.contract.test.ts`, docker-gated, graceful skip, E2E gating rules unchanged — plain `it` + `dockerUp()` like the adversarial/decoy tests): plants an **inline-table** `foundry.toml` (`[profile]` / `default = { ffi = true }`) — empirically verified against the image's real forge 1.8.3 to resolve `"ffi": true` while the line-based sed rewrite cannot match it (the exact gate-1 refusal path). Runs the production entrypoint with runSimContainer's hardening (`:ro` repo, `/poc` overlay, `FOUNDRY_FFI=false`, SIGKILL budget; `FORK_BLOCK=1` skips `cast`, so `--network none` suffices), asserts the rejection, then asserts `/poc/stderr.txt` through the exact `stderrTail()` transform (`readFile` + `trim` + `slice(-400)`) contains `resolved foundry config has ffi enabled — refusing to run`. **Ran and passed** against the rebuilt image (495 ms), not skipped.
- Image rebuilt per the documented workflow: `docker build -t rextor/analyzer packages/agent/analyzer` (only the COPY layers rebuilt).
- 4a: `docs/track-profiles.md:25` — `packages/contracts` `RextorAttestation` → `` `contracts/attestation-evm/src/RextorAttestation.sol` `` (path verified to exist).

## Verification (commands + outputs)

Per fix, before each commit: `cd packages/agent && pnpm vitest run && pnpm typecheck` + root `pnpm test:run && pnpm typecheck`.

- `pnpm vitest run test/openrouter.test.ts test/sim.test.ts` → `2 passed (2)`, `31 passed (31)`
- `pnpm vitest run test/review.test.ts` → `1 passed (1)`, `17 passed (17)`
- `pnpm vitest run test/github.test.ts` → `1 passed (1)`, `5 passed (5)` (after fixing a wrong `tmpdir` import source in the new test — `node:os`, not `node:path`)
- `pnpm vitest run test/sim.contract.test.ts --reporter=verbose` → adversarial ✓ 5317 ms · gate-refusal ✓ 495 ms · decoy ✓ 4760 ms; `3 passed | 1 skipped` (the skip is the standing `REXTOR_SIM_E2E` anvil test — gating rules unchanged)
- Full wave final: agent `pnpm vitest run` → `14 files, 161 passed | 1 skipped (162)` (baseline 155 + 6 new); agent + root `pnpm typecheck` clean; root `pnpm test:run` → `1 successful` task.
- Baseline was 155 passed/1 skipped; wave adds exactly 6 tests, breaks none.

## Concerns (no scope taken)

1. **Fix 3 channel nuance, empirically established.** On the refusal path `runSimContainer` still never reaches its `stderrTail()` read: `docker run` exits 1, so `execFileP` rejects before the artifact read and the wrapped `sim harness produced no result (forge stderr: …)` message never forms. Operator visibility is nonetheless achieved end-to-end — verified by probe: the thrown message is `Command failed: docker run …\nresolved foundry config has ffi enabled — refusing to run` (Node execFile appends the docker CLI's stderr passthrough). So the prescribed fix works, but the tail arrives via the execFile passthrough channel, not `stderrTail()`. Making `stderrTail()` the canonical channel would need a small runner-side catch — explicitly ruled out by the prescription ("zero runner-side changes"), so left untouched.
2. **Image freshness.** The new gate test pins the rebuilt image's behavior; a stale local `rextor/analyzer` (built before `aceb80c`) fails it because the baked sim.sh lacks the stderr.txt write. Rebuild command is documented in the plan and in the commit message.
3. **Probe artifact note:** during verification, a probe with `repoDir` under `/tmp` confirmed the Fix 2 failure mode live (container saw an EMPTY `/repo` — no foundry.toml reached the gates). Repro of the exact bug the fix removes; consistent with the simTmpBase rationale.

## Files touched

- `packages/agent/src/profile.ts`, `packages/agent/src/sim.ts`, `packages/agent/src/github.ts`
- `packages/agent/analyzer/sim.sh`
- `packages/agent/test/openrouter.test.ts`, `test/sim.test.ts`, `test/review.test.ts`, `test/github.test.ts`, `test/sim.contract.test.ts`
- `docs/track-profiles.md`
