# Task 6 Report — SPEC-4 Attestation Contract (Foundry)

**Commit:** `a65df42` — `feat: SPEC-4 RextorAttestation contract — agent registry, idempotent attest, verify`
**Branch:** `feat/week-2-depth` (on top of `2472278`). Working tree clean post-commit. GPG-signed (git `%G?` = G), author RECTOR, zero AI attribution.

## What was implemented

Greenfield Foundry project in `contracts/attestation-evm/` (was `.gitkeep` only):

- `foundry.toml` — brief-exact (byte-diffed): src/out/libs + `solc_version = "0.8.24"`.
- `src/RextorAttestation.sol` — brief-exact (byte-diffed against the brief's embedded source). Agent registry (`registerAgent`/`setAgentActive`, onlyOwner → `NotOwner`), `attest` with validation order active→score→status, webhook-redelivery idempotency, `attestations`/`verify` views, events `AgentRegistered`/`AgentActiveChanged`/`Attested` (full payload, indexed `reviewId` + `agent`), errors `NotOwner`/`NotActiveAgent`/`IdempotencyConflict`/`InvalidScore`/`InvalidStatus`. Immutable v1: no upgrade path, no admin rescue.
- `script/Deploy.s.sol` — brief-exact (byte-diffed): `DEPLOY_PRIVATE_KEY` env → broadcast deploy.
- `test/RextorAttestation.t.sol` — the brief's 10 tests, semantics exactly as written; two fixes below.
- `PROVENANCE.md` — mirrors `fixtures/vault/PROVENANCE.md` format.
- `.gitignore` (project-local) — `out/` + `cache/`, exactly the fixtures/vault pattern. Deleted obsolete `.gitkeep`.
- `lib/forge-std` — vendored 68 files, same discipline as fixtures (fixtures also commits its vendored lib).

## TDD evidence

**RED** (after Step 1, before implementation):

```
$ cd contracts/attestation-evm && forge test
Error (6275): Source "src/RextorAttestation.sol" not found: File not found.
 --> test/RextorAttestation.t.sol:5:1: import "../src/RextorAttestation.sol";
```

**GREEN** (after Step 3):

```
$ forge build && forge test
Compiler run successful!
[RextorAttestationTest] 10 tests:
[PASS] test_attest_conflict_reverts()       [PASS] test_attest_deactivatedAgentReverts()
[PASS] test_attest_happy()                  [PASS] test_attest_idempotent_samePayload()
[PASS] test_attest_incompleteStatusRoundTrip()  [PASS] test_attest_invalidScoreReverts()
[PASS] test_attest_invalidStatusReverts()   [PASS] test_attest_unregisteredAgentReverts()
[PASS] test_register_gatedToOwner()         [PASS] test_verify_falseOnMismatch()
Suite result: ok. 10 passed; 0 failed; 0 skipped
```

**pnpm gates** (repo root): `pnpm test:run` → 1 task successful (turbo-cached; contracts are outside the workspace, inputs unchanged since Task 5); `pnpm typecheck` → 1 task successful.

## forge-std provenance

`forge install foundry-rs/forge-std --no-git` → upstream master @ `7fdf81f9ceb2f6ebbb8f9f1c6c5274d5bcc9a1f5` (2026-09-10). Verified two ways: vendored tree is byte-identical to `fixtures/vault/lib/forge-std`, and GitHub API confirms that hash is current master HEAD. `--no-git` leaves no embedded `.git`, hence PROVENANCE.md.

## .gitignore decision

Brief text is self-contradictory ("add to the root .gitignore … the same way fixtures do"). Fixtures' actual pattern is a **project-local** `.gitignore` with `out/` + `cache/`, so I mirrored that (`contracts/attestation-evm/.gitignore`). Note the root `.gitignore`'s global `out/` and `cache/` entries already cover these paths (`git check-ignore -v` confirms the local file wins at scoped level; behavior identical either way) — I did not add redundant scoped entries to the root file. Controller can override trivially if root entries are preferred.

## Self-review findings

1. **Brief test bug (fixed, compile-necessity):** the brief's `test_attest_happy`/`test_attest_idempotent_samePayload` destructure `(, , , , , uint64 reviews)` — **6 components** — from `c.agents(address(this))`, whose auto-getter returns 3 values `(string name, bool active, uint64 reviewCount)`. Does not compile (tuple size mismatch). Fixed minimally to `(, , uint64 reviews)`; semantics unchanged (binds `reviewCount`). This was not among the controller's pre-flagged cosmetic oddities (those were the over-indented `assertEqUint` lines — also fixed).
2. **Idempotency byte-comparison:** all 5 payload fields compared with `==` (reviewId is the mapping key); identical → early return **before** `reviewCount += 1` and before the event (SPEC-4 invariant 13; exercised by `test_attest_idempotent_samePayload`, reviews stays 1); any difference → `IdempotencyConflict` (`test_attest_conflict_reverts`). Existence sentinel is `agent != address(0)` — safe: `address(0)` can never hold an attestation since `msg.sender == address(0)` is unreachable, and `verify()` correctly returns false for unknown ids.
3. **reviewCount:** incremented exactly once per fresh reviewId, storage-pointer write on `agents[msg.sender]`; uint64 overflow → 0.8.24 panic (unreachable in practice). Re-registering an existing agent resets count to 0 (brief-exact; not exercised by the suite — acceptable for v1, owner-controlled operation).
4. **Byte-exactness audit:** contract/deploy/toml diffed clean against the brief's embedded sources (only my first sed range picked up a fence line — file content exact).
5. **Lint notes** (advisory, not fixed — brief source is binding): forge-lint `unaliased-plain-import`, `named-struct-fields`, `screaming-snake-case-immutable`, `unwrapped-modifier-logic`, and 2× `unsafe-typecast` on `bytes20→bytes32` — that cast is the SPEC-4-mandated right-zero-padding of the 20-byte git sha, intentional.
6. Edge considered, no action (brief-exact): same-payload re-attest from a *different* active agent is a no-op keeping the original attester; SPEC constrains payload identity only.

## Concerns

- None blocking. The two deviations from the brief's literal test text are documented above (one controller-preauthorized formatting, one compile-necessity with preserved semantics). Task 8's ABI encoding is unaffected — the deployed interface is byte-exact per the brief's Interfaces block.
