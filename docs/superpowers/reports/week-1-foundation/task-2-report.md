# Task 2 Report — Slither runner container + NDJSON CLI contract

Commit: `5b2e61c` `feat: slither runner container with NDJSON contract` (branch `feat/week-1-engine-loop`, 3 files, +119).

## What was built

- `packages/agent/analyzer/Dockerfile` — `python:3.12-slim`; curl/ca-certificates layer; `slither-analyzer`; `solc-select` pinned to 0.8.24; **Foundry v1.8.1 via foundryup (Ruling 6)** with `ENV PATH`; slow foundryup layer placed above the `COPY run.sh` layer so run.sh edits never invalidate it; apt lists / pip caches pruned in-layer.
- `packages/agent/analyzer/run.sh` — the NDJSON contract engine (details below; `chmod +x` via Dockerfile, committed mode 100755).
- `packages/agent/test/analyzer.contract.test.ts` — vitest, `describe.skipIf(!docker)`, both brief cases.

Image built: `docker build -t rextor/analyzer packages/agent/analyzer` — success (44s; foundryup verified forge/cast/anvil/chisel/solar for linux/arm64 against attestation).

## Brief + ruling deviations (all verified empirically)

1. **Ruling 3 applied**: `TMP="$(mktemp -d)/slither.json"`.
2. **Ruling 6 applied**: Foundry layer added; ~200MB accepted.
3. **`--fail-none` added to the slither invocation.** Latent defect in the brief: slither's default exit code is 255 whenever a Medium/High finding exists, so the brief's `if slither …; then` would route a finding-rich (successful) run into the incomplete branch — the primary fixture case could never pass as written.
4. **`>/dev/null` on the slither invocation.** Verified that crytic-compile progress lines (`'forge clean' running…` etc.) go to the container's **stdout** (stderr is empty; proven with `2>/dev/null` vs `2>&1 >/dev/null`). They corrupted the NDJSON stream — the first vitest run failed on `SyntaxError: Unexpected token '''` for exactly this reason. After the redirect, container stdout is pure NDJSON.
5. **"No contract was analyzed" → incomplete + exit 3.** On a contract-less dir slither exits **0** and writes `{"success": true, "error": null, "results": {}}` (no `detectors` key) while printing `No contract was analyzed` to stderr — the brief's parser emitted zero lines with exit 0: the forbidden silent clean pass. run.sh now treats zero detectors + that stderr marker as `{"status":"incomplete","reason":"no-contract-analyzed"}` + exit 3. A genuine zero-findings repo (stderr says `N contracts … 0 result(s)`) still exits 0 with zero lines.
6. **Incomplete line emitted via python `json.dumps`** in the failure branch: the brief's shell interpolation of raw stderr breaks single-line JSON if the error text contains quotes.
7. **Parser guard**: `(d.get("elements") or [{}])[0]` — the brief's `d.get("elements", [{}])[0]` raises IndexError on an empty elements list, which would kill the whole finding pass.
8. **Test fixture path fixed.** Brief Step 6 runs from `packages/agent`, so the brief's `${process.cwd()}/fixtures/vault` resolves to `packages/agent/fixtures/vault` (nonexistent; fixture lives at repo root). The test resolves the repo root via `import.meta.url` (cwd-independent).
9. **`catch (e: any)` → `catch (e)` + reasoned cast, explicit `Finding` type, typed callbacks** — project `ts-no-any` rule; no behavioral change.

**Parser shape vs brief: NO key adjustments needed.** Actual slither JSON matched the brief's parser expectations exactly (`results.detectors[].impact|check|description`, `elements[0].source_mapping.filename_relative|lines`). Every change above is exit-code/stream/shape-of-contract, not JSON key shape.

## Manual container-run outputs (verbatim)

Fixture (`docker run --rm -v $(pwd)/fixtures/vault:/repo rextor/analyzer`, stdout only), **exit 0**:

```json
{"file": "Vault.sol", "line": 16, "severity": "high", "check": "reentrancy-eth", "description": "Reentrancy in Vault.withdraw() (src/Vault.sol#16-21):\n\tExternal calls:\n\t- (ok,None) = msg.sender.call{value: amount}() (src/Vault.sol#18)\n\tState variables written after the call(s):\n\t- deposits[msg.sender] = 0 (src/Vault.sol#20)\n\tVault.deposits (src/Vault.sol#6) can be used in cross function reentrancies:\n\t- Vault.deposit() (src/Vault.sol#11-13)\n\t- Vault.deposits (src/Vault.sol#6)\n\t- Vault.withdraw() (src/Vault.sol#16-21)\n"}
{"file": "Vault.sol", "line": 24, "severity": "low", "check": "missing-zero-check", "description": "Vault.setOwner(address).next (src/Vault.sol#24) lacks a zero-check on :\n\t\t- owner = next (src/Vault.sol#25)\n"}
{"file": "Vault.sol", "line": 16, "severity": "low", "check": "low-level-calls", "description": "Low level call in Vault.withdraw() (src/Vault.sol#16-21):\n\t- (ok,None) = msg.sender.call{value: amount}() (src/Vault.sol#18)\n"}
```

Contract-less dir, **exit 3**, stdout exactly:

```json
{"status":"incomplete","reason":"no-contract-analyzed"}
```

`forge` writes `out/` + `cache/` into the mounted fixture; both are covered by `fixtures/vault/.gitignore` and are NOT committed (`git status --porcelain` clean after commit).

## Test output

`cd packages/agent && pnpm vitest run test/analyzer.contract.test.ts`:

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Both cases execute (docker available; `skipIf` not triggered).

## Verification notes

- Stream split proven: `2>/dev/null` shows pure NDJSON; `2>&1 >/dev/null` shows empty stderr on the fixture path.
- Exit codes observed: fixture 0; empty dir 3.
- Scoped `tsc --noEmit` on the package: my file contributes only 2 × TS2591 (`node:child_process`, `node:url`) — the package-wide missing `@types/node` devDependency (see concerns). All implicit-any/`any` in my file eliminated via explicit types.

## Self-review findings (resolved before/amend-of commit)

- First edit pass on the test file mis-targeted a line number, briefly leaving both old and new catch blocks (caught by the edit tool's parse warning; fixed immediately, verified by vitest).
- Implicit-any cascade in test callbacks fixed with explicit `Finding` type (project ts-no-any rule).
- One `git commit --amend --no-edit` after the typing fix — final commit is a single clean feature commit `5b2e61c` containing exactly `packages/agent/analyzer` + `packages/agent/test`.

## Concerns

1. **solc-select's solc is amd64-only on this arm64 host.** `solc-select install 0.8.24` on linux/arm64 yields an x86_64 ELF that cannot execute under colima (`qemu-x86_64: Could not open '/lib64/ld-linux-x86-64.so.2'`). Consequence: repos WITHOUT a framework marker (bare `*.sol` dirs hitting crytic-compile's solc platform) fail with `incomplete` + exit 3 (honest, contract-compliant, but a real capability gap on arm64). Foundry projects are unaffected — forge/svm ships native aarch64 solc, which is why the fixture works. Worth a follow-up (e.g. bake a native solc or route solc-platform compiles through forge's solc).
2. **`@types/node` missing from `packages/agent`** (pre-existing from Task 1): strict `tsc --noEmit` is red package-wide, including pre-existing errors in `diff-scope.test.ts` (extensionless relative import TS2835 + implicit-any). Outside my sanctioned commit paths; left for the package owner / main agent's project-wide validation pass.
3. **macOS `$TMPDIR` (`/var/folders/…`) is not shared into the colima VM**, so the contract test's empty-dir mount is realized as an empty dir inside the VM rather than a bind of the host dir. Observable contract behavior is identical (empty repo → incomplete + 3) and Linux CI is unaffected.
4. **Every run recompiles**: crytic-compile invokes `forge build --force`, and forge's solc cache lives in the container's ephemeral `~/.svm`, so each run re-downloads solc 0.8.24 (~3s observed end-to-end). Acceptable at week-1 scale; a named volume or baked svm cache is the obvious later optimization.

## Fix round 1 (controller review) — commit `b0b1335` `test: zero-findings clean-pass contract test + pin slither`

### IMPORTANT — zero-findings clean-pass regression guard

- **Fixture `fixtures/vault-clean/`** (foundry-based per review note): `foundry.toml` (same shape as fixtures/vault, pins solc 0.8.24), `src/Clean.sol` (simple getter/setter, exact `pragma solidity 0.8.24` — no caret, so no solc-version informational), `.gitignore` (`out/`, `cache/`).
- **Empirical verification BEFORE pinning the test**: manual `docker run --rm -v $(pwd)/fixtures/vault-clean:/repo rextor/analyzer` → **exit 0, stdout literally empty** (`CLEAN_STDOUT=[]`), re-verified against the re-pinned image. Zero findings means literally none — no Low/Informational noise. (Any Informational finding would have been emitted as severity "low" by the parser's impact mapping, so the empty stdout proves none of any impact.)
- **Third test** `exits 0 with empty stdout on a zero-findings repo (never incomplete)` pins contract case (b): asserts exit 0 (execFileSync success) AND `stdout.trim() === ""` — an empty-but-successful analysis must never surface as `{"status":"incomplete"}`.
- **(b)-vs-(c) discrimination now test-pinned**: the failure test additionally asserts `stdout` contains `"status":"incomplete"`, so if the stderr marker (`No contract was analyzed`) ever drifts in a future slither, the suite detects the misclassification (exit 0 on the no-contract case fails the status assertion; exit 3 on the clean case fails the new test).
- **Flake found and hardened, honestly**: the first post-rebuild suite runs failed the empty-dir case with the docker spawn throwing in ~2ms (no container exit — transient churn on the shared colima daemon; manual 10× loop shows the container contract is deterministic, 10/10 exit 3 + incomplete line). `runAnalyzer()` helper added: retries ONLY status-less spawn/daemon transients (3 attempts); a real container exit (numeric status) is returned as-is and judged strictly. No contract assertion is weakened by this.

### MINOR — run.sh comment reword

Verified from installed source (`slither/__main__.py:497`: `set_defaults(fail_on=FailOnLevel.PEDANTIC)`) that slither **0.11.6** defaults to pedantic — 255 on ANY finding (any impact), not just Medium/High as my comment claimed. Comment reworded accordingly. (The review said "installed 2.x"; the installed and now-pinned version is **0.11.6** — behavior claim confirmed, version corrected against the actual image.)

### MINOR — pin slither-analyzer

`pip install --no-cache-dir slither-analyzer==0.11.6` (the empirically verified version), with a comment tying the pin to run.sh's stderr-marker classification. Image rebuilt; all three contract cases re-verified manually post-rebuild (vault → exit 0 + findings; vault-clean → exit 0 + empty stdout; empty dir → exit 3 + incomplete line).

### Command + output

`cd packages/agent && pnpm vitest run test/analyzer.contract.test.ts` — run twice consecutively:

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

(both runs green, 4.57s / 4.48s). Scoped `tsc --noEmit` on the file: only the pre-existing package-wide `@types/node` gap (3 × TS2591 for `node:child_process`, `node:url`, `Buffer`) — unchanged error class, runtime unaffected.

### Fix-round self-review note

Two intermediate tool-edit misfires while updating the test (mis-targeted line → stray block closer; instrumentation referencing an undefined name) were caught by the edit tool's parse warnings and by the failing suite itself, then fixed before commit. The final commit is a single clean `b0b1335` over exactly `packages/agent/analyzer`, `packages/agent/test`, `fixtures/vault-clean`.
