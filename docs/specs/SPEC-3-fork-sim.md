# SPEC-3 — Fork-Sim Proof Layer (Foundry, EVM)

**Series:** [`SPEC.md`](../../SPEC.md) holds the product contract; this is subsystem spec 3 of 6 (see spec index there).
**Status:** ACTIVE — implemented by the Week-2 plan.
**Phase:** Week 2. EVM only post-Gate-B (Solana liteSVM = adapter tier behind a future Gate B′ — out of scope here).

## Purpose

"PoC-gated criticals": for every critical/high finding surviving triage, attempt dynamic reproduction on a Foundry fork of the target chain. Confirmed exploits get a RUNNABLE PoC test attached to the PR comment (the money demo); attempted-but-failed downgrades the critical's rubric weight (SPEC-2 v1). Sim never deletes a finding — static evidence stands; sim corroborates or fails to.

## Components & contracts

### 1. PoC generation (frontier LLM, always)

- Input to the model: the post-triage finding, its source-file excerpt (± 20 lines from the clone), and the fork context (chain label, pinned block). Output: ONE Foundry test file:
  - `RextorPoc.t.sol`, contract `RextorPocTest`, one test per finding: `testRextorPoc_<id>` asserting the exploit SUCCEEDS (balance drained / state broken) — the test passes only when the bug reproduces.
  - forge-std `Test` import; no `vm.ffi`.
- Generated source is untrusted on three axes: renderable data (§4), compile input, and prompt content — never instructions.
- Generation failure (unparseable output / compile error) is a sim RESULT (`unproven`), not a pipeline failure.

### 2. Sim harness (analyzer container, network profile)

- Env: `REXTOR_FORK_RPC_URL` (unset → ALL sims skipped: `poc: "skipped"`, comment notes "fork-sim skipped: no fork configured"); `REXTOR_FORK_BLOCK` optional pin — unset = latest at run time; the block actually used is recorded in the result and comment (reproducibility).
- Run: analyzer image (already ships forge), repo mounted `:ro`, generated test written to a separate writable overlay dir; `forge test --match-contract RextorPocTest --fork-url <rpc> [--fork-block <n>]`, wall-clock timeout 240 s, result parsed from forge's per-test output.
- Hardening (binding): `FOUNDRY_FFI=false` env override whose PRECEDENCE over a PR-controlled `foundry.toml` (`ffi = true`) is proven by an adversarial test; `--fork-url` passed on the CLI (overrides config `eth_rpc_url`); only `RextorPocTest` executes; EVM execution is confined to the fork chain by construction. Residual risk (documented, accepted): the sim container needs network egress (RPC + possible solc download for non-prewarmed pins) — it is the ONLY network-enabled container in the system.

### 3. Result mapping (`packages/agent/src/sim.ts`)

`Finding` gains optional `poc?: { status: "confirmed" | "unproven" | "skipped"; testSource?: string; block?: number }` — set only for critical/high final findings.

- test PASS → `confirmed` (exploit reproduced) — PoC source attached; rubric keeps 60.
- test FAIL / compile error / generation failure / timeout → `unproven` — rubric v1 downgrades a CRITICAL to 25; the comment still labels it CRITICAL with "(PoC unproven)".
- not attempted (no fork env, or severity below high) → `skipped` — no rubric change.
- Adversarial note (accepted for v1): a party hiding a true critical benefits if OUR PoC generation fails; the mitigation is presentation (loud CRITICAL-unproven label + intact static finding), not score.

### 4. Comment rendering

- Confirmed findings render a collapsed `<details><summary>Runnable PoC (Foundry)</summary>` with the generated test source. Fence = 4-backtick ` ````solidity ` block; any 3+-backtick run INSIDE the source is collapsed to a single backtick before embedding (valid Solidity cannot contain triple backticks — the rewrite only defeats fence-escape injection); `\r` stripped.
- Sim summary line: fork block used, per-finding status. Skipped-with-reason when no fork configured.

### 5. Pipeline position (with SPEC-2 §4)

`analyze → normalize → [triage] → [sim: criticals/highs only] → score(rubric v1) → [attest: SPEC-4] → ONE comment`. Sim runs INSIDE the review; the async webhook queue (Week-2 hardening) owns delivery latency. `ReviewDeps` grows: `generatePoc?` (LLM seam) and `runSim?` (container seam) — absent/env-unset → skipped path. Offline unit tests inject both; Docker-gated tests run the real container and skip gracefully (SPEC-1 invariant 4).

## Cross-cutting invariants

9. Sim results mutate ONLY `poc` fields (plus rubric weight via SPEC-2 v1) — never severities, never finding existence.
10. A confirmed PoC's `testSource` is part of the canonical findings JSON → covered by findingsHash → covered by SPEC-4 attestation.
11. `confirmed` requires the exact generated test passing against the recorded block on the configured fork — reproducible by anyone who re-runs it.

## Acceptance

- Unit (fakes): mapping pass/fail/error → confirmed/unproven; skip path with env unset; comment blocks (details fence, backtick-collapse sanitizer, unproven label).
- Adversarial: `foundry.toml` with `ffi = true` + a planted `vm.ffi` test → run under harness env → ffi reverts (env override precedence proven).
- Docker-gated E2E (opt-in `REXTOR_SIM_E2E=1`): fixtures/vault, pre-written PoC (not LLM), local `anvil` fork inside the container → `confirmed`, PoC rendered.
- Rubric interaction: critical-confirmed = 60, critical-unproven = 25, critical-skipped = 60 (cross-spec vector, pinned in SPEC-2 tests too).
