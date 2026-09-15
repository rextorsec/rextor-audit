# Task 1 Report: Vulnerable Vault fixture + proving Foundry test

**Status: DONE** · Branch `feat/week-1-engine-loop` · Commit `ac00328` (GPG-signed via global config, no AI attribution)

## What was implemented

Created the Week-1 ground-truth fixture per `task-1-brief.md`, code verbatim, with the one
controller-ruled deviation:

- `fixtures/vault/foundry.toml` — verbatim (src/out/lib dirs, solc 0.8.24).
- `fixtures/vault/src/Vault.sol` — verbatim. VULN 1: reentrancy in `withdraw` (external call
  before `deposits` zeroing). VULN 2: unguarded `setOwner` (ETH lock-in vector).
- `fixtures/vault/test/Vault.t.sol` — verbatim **except** the ruled deviation: deleted
  `payable(address(attacker)).transfer(0);` from `test_reentrancy_drains_vault`. Rationale held
  up: `.transfer` forwards 2300 gas; `Attacker.receive` then evaluates cold
  `address(vault).balance` (2600 gas) → OOG → revert → test failure. The remaining
  `vm.deal` → prank deposit → prank withdraw path executes the drain.
- `fixtures/vault/.gitignore` — exactly two lines: `out/`, `cache/` (root `.gitignore` untouched).
- `fixtures/vault/lib/forge-std/` — vendored via `forge install foundry-rs/forge-std --no-git`
  (plain files, no root submodule/`.gitmodules` change). Required because the test imports
  `forge-std/Test.sol`; hermetic so Task 2's Slither container can run `forge test` offline.

## Forge run + output

`cd fixtures/vault && forge test -vvv` (forge 1.5.1, Solc 0.8.24):

```
Compiling 21 files with Solc 0.8.24
Solc 0.8.24 finished in 311.30ms
Compiler run successful!

Ran 1 test for test/Vault.t.sol:VaultTest
[PASS] test_reentrancy_drains_vault() (gas: 150534)
Suite result: ok. 1 passed; 0 failed; 0 skipped; finished in 2.43ms (702.92µs CPU time)

Ran 1 test suite in 89.18ms (2.43ms CPU time): 1 tests passed, 0 failed, 0 skipped (1 total tests)
```

SPEC-1 acceptance: exploit PASS = fixture validity proof. Attacker ends with 2 ETH > 1 ETH
deposited (own deposit + drained vault balance).

## Files changed (commit ac00328)

- `fixtures/vault/foundry.toml` (+5)
- `fixtures/vault/src/Vault.sol` (+26)
- `fixtures/vault/test/Vault.t.sol` (+28, 29 brief lines − 1 ruled deviation)
- `fixtures/vault/.gitignore` (+2)
- `fixtures/vault/lib/forge-std/**` (vendored, ~68 files)

## Self-review findings

- `git show HEAD:.../Vault.t.sol`: `transfer(0)` absent; `vm.deal`/2×`vm.prank`/`assertGt` present — deviation applied, rest verbatim.
- `git status` clean; `--ignored=matching` shows only `fixtures/vault/out/` and `fixtures/vault/cache/` ignored by the fixture `.gitignore`.
- Committed on top of `92d62eb` as expected; no stray artifacts.

## Concerns

1. **Vendored forge-std in the commit (~68 files).** The exact-two-line `.gitignore` ruling
   implies `lib/` is committed. Alternative was a root-level submodule (`forge install` default),
   which would have touched root `.gitmodules`/index — excluded by the rulings. Vendoring keeps
   the fixture hermetic. Flagging in case the controller prefers slimming the lib to
   `src/Test.sol` + `src/Vm.sol` deps later.
2. VULN 2 (`setOwner`) has no proving test — out of scope per brief (Task 2/Week 2 ground truth);
   noted so triage expectations include it.
