# Task 5 Report — SPEC-3 sim harness (container runner, FFI adversarial test, anvil E2E)

**Commit:** `5756307` — `feat: SPEC-3 sim harness — containerized forge fork run, FFI-denied, anvil E2E` (branch `feat/week-2-depth`, on top of `4c262fa`)

## What was implemented

1. **`packages/agent/analyzer/sim.sh`** (new, baked at `/usr/local/bin/sim.sh`, mode 755): the in-container fork-sim harness. Resolves `BLOCK="${FORK_BLOCK:-$(cast block-number --rpc-url "$FORK_URL")}"` and ALWAYS passes it to forge; mirrors the repo into a writable `/poc/simroot` via symlinks (skipping `out`/`cache`/`.git`/`test`/`foundry.toml`); copies the PoC into `simroot/test/`; runs `timeout -k 5s 220s forge test --match-contract RextorPocTest --fork-url … --fork-block-number … --json` with `FOUNDRY_FFI=false` exported; writes `result.json`, `stderr.txt` (+ forge exit code appended diagnostically), `block.txt`.
2. **`packages/agent/analyzer/Dockerfile`**: `COPY sim.sh` + combined `chmod +x` in the same layer family as run.sh. Analyzer path (`run.sh`, ENTRYPOINT `timeout -k 5s 140s`, non-root user) untouched. Image rebuilt and verified.
3. **`packages/agent/src/sim.ts`**: exported `parseForgeJson(raw): Record<string, boolean>` (bare test names), exported `simTmpBase()` (shared overlay-base decision), and the real `runSimContainer(repoDir, testSource, forkUrl): Promise<SimOutcomeMap>` — binding interface honored. Hardening per SPEC-3 §2: `--network bridge` (only network-enabled container), repo `:ro`, writable overlay mount, `FOUNDRY_FFI=false` env, `REXTOR_FORK_BLOCK` per-call passthrough, 240s execFile timeout with SIGKILL, cleanup in `finally`. Artifact-read failure rethrows with the container stderr tail (mapped upstream to `unproven`).
4. **`packages/agent/src/github.ts`**: default deps now wire `generatePoc: generatePocFromEnv()` and `runSim: runSimContainer`.
5. **`packages/agent/test/sim.contract.test.ts`** (new): docker-gated tests with graceful skip (`docker info` probe, SPEC-1 invariant 4). E2E additionally gated on `REXTOR_SIM_E2E=1` (`maybeIt`); adversarial ffi test runs docker-gated by default (no opt-in needed).
6. **`packages/agent/test/sim.test.ts`**: offline `parseForgeJson` unit tests pinned to verbatim captured forge output.

## Empirical findings (the sketch was wrong in four places — all verified, not guessed)

| # | Sketch/spec assumption | Empirical reality (forge 1.5.1 host / 1.8.3 image, docker 29.2.0 colima) | Fix |
|---|---|---|---|
| 1 | `forge test --json` → `{success, test_results:[{name, success}]}` | Top level is `{"path:Contract": {test_results: {"fnName()": {status: "Success"\|"Failure", …}}}}` — string enum, keys carry `()`, no booleans | `parseForgeJson` implements the real shape; pinned to captured literals in offline tests (host 1.5.1 and image 1.8.3 emit identical shape) |
| 2 | flag `--fork-block` | forge 1.8.3 rejects it: `--fork-block-number` | sim.sh passes `--fork-block-number` |
| 3 | `FOUNDRY_FFI=false` env beats PR `foundry.toml` `ffi = true` | **False.** `FOUNDRY_FFI=false forge config` in a dir with `ffi = true` resolves `ffi = true`; a live `vm.ffi` PoC EXECUTED (returned output) under the env override. No `--no-ffi` CLI flag exists | sim.sh writes a **patched COPY** of foundry.toml into simroot (sed rewrites any `ffi = …` assignment to `ffi = false`; default is already false, so nothing else to force). Adversarial run now shows the real revert in-band: `"vm.ffi: FFI is disabled; add the --ffi flag …"` |
| 4 | colima mounts any host path | Only `$HOME` is shared; a `/tmp` bind **silently degrades** to an empty VM-local dir (writes denied even as root) | Overlay dirs default to `$HOME` on darwin (`simTmpBase()`), `/tmp` on Linux, `REXTOR_SIM_TMP_DIR` overrides; overlay dir `chmod 0o777` so the unprivileged analyzer uid (1000) writes through the mount — no `--user` override, SPEC-1 invariant 3 intact |

Two more prototype-caught issues: (a) `mkdir -p simroot/test` before `ln -sfn /repo/test` makes `ln` nest (`test/test/…` doubling every relative import) → test dir is merged entry-by-entry into a real dir; (b) alias imports (`src/X.sol`) don't resolve from `test/` → sim.sh seeds `remappings.txt` with forge's auto remappings + `src/=src/` (relative imports need no help).

## TDD evidence

- **RED** (before implementation): `Test Files 2 failed (2) / Tests 4 failed | 16 passed | 1 skipped` — parser tests and adversarial test fail on missing `parseForgeJson`/`runSimContainer` exports; E2E correctly skipped without `REXTOR_SIM_E2E`.
- **Captured real forge --json shape** (pinned verbatim in `sim.test.ts`):
  - Success (forge 1.5.1, `fixtures/vault`): `{"test/Vault.t.sol:VaultTest":{"duration":"3ms 391µs 916ns","test_results":{"test_reentrancy_drains_vault()":{"status":"Success","reason":null,…,"kind":{"Unit":{"gas":150622}},…}},"warnings":[]}}`
  - Failure (forge 1.5.1, scratch probe): `{"test/Vault.t.sol:FailProbe":{…,"test_fail_probe()":{"status":"Failure","reason":"deliberate",…}}}` (forge exit 1)
  - FFI denial (forge 1.8.3, adversarial run): `{"test/RextorPoc.t.sol:RextorPocTest":{…,"testRextorPoc_0()":{"status":"Failure","reason":"vm.ffi: FFI is disabled; add the \`--ffi\` flag to allow tests to call external commands","fork_block_number":1,…},"test_controlHarnessRan()":{"status":"Success",…}}}`
- **GREEN**: agent suite `11 files / 127 passed | 1 skipped (128)`; `tsc --noEmit` clean; root `pnpm test:run` ✓ + `pnpm typecheck` ✓.
- **E2E (daemon up)**: `REXTOR_SIM_E2E=1 pnpm vitest run test/sim.contract.test.ts` → **2 passed (2)** in ~5s wall clock. E2E asserts `out.block > 0` and `out.results["testRextorPoc_0"] === true` (proving vault drain, mirrored from `Vault.t.sol`). Default run (no env): `1 passed | 1 skipped` — adversarial runs docker-gated, E2E opt-in, exactly per contract.
- **FORK_BLOCK pin path** (throwaway container run): with `FORK_BLOCK=1` exported, `block.txt=1` and the PoC passes on the pinned block.

## Image rebuild

`docker build -t rextor/analyzer packages/agent/analyzer` — rebuilt twice as sim.sh evolved (final `sha256:70810537d260…`); verified `/usr/local/bin/sim.sh` present, `#!/bin/sh`, mode 755; `sh -n` clean. Both contract tests run against the rebuilt image.

## Adversarial test design note (deviation from the brief's sketch)

The sketch suggested asserting "stderr mentions ffi", but the binding interface `runSimContainer → SimOutcomeMap` exposes no stderr, and the pocDir is destroyed in `finally`. Instead the PoC is a **biconditional + control**: `testRextorPoc_0` passes iff `vm.ffi` executes; `test_controlHarnessRan` (plain `assertTrue`) passes iff the fixture compiled and the harness ran. Asserting `control === true && testRextorPoc_0 === false` through the production `runSimContainer` is therefore a *stronger* in-band proof of FFI denial than stderr wording — it rules out both "compile failure masquerading as denial" and "test re-implementation diverging from the production harness". The adversarial test starts a standalone anvil container and points the real harness at its bridge IP (docker 29/colima: IP at `NetworkSettings.Networks.bridge.IPAddress`, the legacy top-level field is empty — probed).

## Self-review findings (fixed before commit)

- `status` in sim.sh was assigned-but-unused → now appended to `stderr.txt` as `forge exit: N` (diagnostic; `result.json` stays the source of truth).
- `Promise.withResolvers` in the test needed lib es2024; project pins ES2022 → executor-form inline delay in the anvil-readiness poll, with the real-timer exception documented (the awaited condition lives in an external docker process; fake timers cannot advance it).
- Fixed during development (anchor-edit churn, no repo impact): wrong `import.meta.url` depth for fixtures, inspect template, transient sim.ts/sim.sh mangling — final files read back clean; `git diff` reviewed line-by-line before the single commit.

## Concerns

1. **`FOUNDRY_FFI=false` alone is NOT sufficient on any foundry version with this config layering** — the FFI-denial guarantee rests on sim.sh's patched foundry.toml copy. The sed targets any `ffi = …` assignment (incl. quoted keys); a foundry version that changes config layering or adds an ffi-enabling default elsewhere would need this revisited — the adversarial test will catch it.
2. **macOS dev quirk, documented in code**: the overlay dir must live under a daemon-shared path (`$HOME` on darwin). `github.ts`'s `clone()` still uses `os.tmpdir()` for repo clones — on macOS the resulting `:ro` repo mount would silently degrade to an empty dir (both for the analyzer and now the sim). Production/CI is Linux, where `/tmp` is fine; flagging in case macOS-local webhook runs ever matter.
3. The E2E helper (`runSimContainerAnvil`) necessarily duplicates runSimContainer's docker invocation shape (anvil must start inside the same container for 127.0.0.1); it shares `simTmpBase()`/`parseForgeJson` so parse and base-dir logic cannot diverge, and its doc comment pins the hardening properties it mirrors.
4. Each `docker run` recompiles the project in simroot (out/cache skipped by design — PR artifacts must not leak into the sim). Measured ~1.5–2s for the vault fixture on arm64; large PRs will pay proportionally more of the 220s inner budget.

---

# Fix Round 1 — controller verdict on `5756307` (Critical 1 + Important 2, 3)

**Commit:** `b94f182` — `fix: SPEC-3 sim hardening — resolved-config ffi gate, match-path decoy isolation, baked forge-std pin`

## CRITICAL 1 — FFI sed bypass via TOML dotted key → FIXED (fail-closed, all config vectors)

sim.sh now asserts the **RESOLVED** config after assembling simroot (controller-prescribed mechanism):

```sh
if FOUNDRY_FFI=false forge config --json 2>/dev/null | grep -q '"ffi"[[:space:]]*:[[:space:]]*true'; then
  echo "resolved foundry config has ffi enabled — refusing to run" >&2
  exit 1
fi
```

A violation is a harness failure → `unproven` upstream; the sed patch stays as hygiene. Adversarial suite now covers three ffi vectors: linear `ffi = true`, in-table dotted `profile.default.ffi = true` (both: control passes + `testRextorPoc_0` false through the production harness), and root-level dotted key — which on forge 1.8.3 makes the config **unparseable** (`forge config --json` emits nothing), so the harness rejects the run entirely (`rejects.toThrow()`). Empirical nuance, probed in-image: on 1.8.3 neither dotted placement RESOLVES ffi enabled (in-table → `"ffi": false`; root-level → config parse failure), so the linear form remains the only live bypass — but the resolved-config gate is what enforces denial for ANY form/toolchain by construction, which is the point of the fix.

## IMPORTANT 2 — decoy same-name contract → FIXED

`sim.sh` forge invocation now carries `--match-path 'test/RextorPoc.t.sol'` (alongside `--match-contract RextorPocTest`), so ONLY the harness-copied file's tests run; `parseForgeJson` keying unchanged. New docker-gated regression: decoy `test/ZZZ.t.sol` with a passing `testRextorPoc_0` planted alongside a deliberately FAILING real PoC → result must read `false` (pre-fix, last-write-wins read the decoy's pass as "confirmed").

## IMPORTANT 3 — PR-controlled forge-std → FIXED (controller's partial-fix mechanism, all three routes)

- **Route (a)**: PR root `remappings.txt` is now excluded from the simroot mirror (joins `out|cache|.git|test|foundry.toml` in the skip list); sim.sh writes its own fresh file.
- **Route (b)+(c)**: remappings.txt is seeded from `forge remappings` (captured before the file exists → toml remappings + lib auto-detection), all `forge-std/` lines stripped, then `forge-std/=/opt/rextor/forge-std/src/` appended. Verified in-image: remappings.txt overrides toml remappings AND auto-detection entirely, so the resolved view has **exactly one forge-std line — the baked copy**.
- **Baked copy**: `fixtures/vault`'s vendored forge-std (upstream commit `7fdf81f9ceb2f6ebbb8f9f1c6c5274d5bcc9a1f5`) copied to `packages/agent/analyzer/vendor/forge-std` (src/ + licenses + package.json, PROVENANCE.md recording the pin), Dockerfile `COPY vendor/forge-std /opt/rextor/forge-std`. Image rebuilt (`sha256:b41b3c1a…`).
- **Fail-closed gate**: sim.sh additionally verifies the resolved remappings pin forge-std to the baked path exactly once — violation ⇒ harness failure. Every gated test therefore exercises this `forge remappings` check through the production path (a regression would fail the entire contract suite, not just one assertion).

## Cheap hardening (also done)

- Corrupted `block.txt` (non-numeric) now **throws** instead of fabricating block 0 — the reproducibility pin (invariant 11) is real or the run fails.
- `parseForgeJson` failures are wrapped with the same container stderr-tail context as the missing-artifacts path.

## Verification

- `REXTOR_SIM_E2E=1 pnpm vitest run test/sim.contract.test.ts` → **3 passed** (E2E + 3-variant ffi adversarial + decoy regression), ~10s.
- Default gating unchanged: `2 passed | 1 skipped` (adversarial pair docker-gated, E2E opt-in).
- Full agent suite: `11 files / 128 passed | 1 skipped (129)`; `pnpm typecheck` clean (agent + root); root `pnpm test:run` ✓.
- `sh -n sim.sh` clean; image rebuild verified (`/opt/rextor/forge-std/src/Test.sol` present, sim.sh mode 755).
