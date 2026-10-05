# SPEC-9 — FundingVerifier Constant-Array Literalization (slither 0.11.6 parse gate)

**Series:** [`SPEC.md`](../../SPEC.md) holds the product contract; this is subsystem spec 9.
**Status:** ACTIVE — 2026-10-05 session (CWF gate: unblocks the SIP monorepo's first dual-engine review + the CodeRabbit A/B receipt).
**Scope source:** `~/Documents/secret/strategy/rextor-audit/SEED-TARGETS.md` SIPHER gate · `docs/competitive-positioning.md` §D/§H residual-gap notes (live inline-comment rendering still undecoded; this PR is the carrier).
**Target:** `contracts/sip-ethereum/src/verifiers/FundingVerifier.sol` in **sip-protocol/sip-protocol** (bb-generated from a Noir circuit, commit `2310557`).

## Problem

`FundingVerifier.sol` (2435 lines, self-contained — zero imports) declares file-scope constants (lines 289–304) and uses them in **array type positions** — struct members, function params/returns, locals:

- `Fr[PAIRING_POINTS_SIZE]`, `Fr[BATCHED_RELATION_PARTIAL_LENGTH][CONST_PROOF_SIZE_LOG_N]`, `Fr[NUMBER_OF_ENTITIES]`, `G1Point[CONST_PROOF_SIZE_LOG_N - 1]`, `Fr[NUMBER_OF_ALPHAS]`, `uint256[NUMBER_OF_ENTITIES + 9]`, …

slither 0.11.6 crashes **at parse time**, not in a detector:

```
ArrayType.__init__ → ConstantFolding(length, "uint256")
  → constants_folding.py:100 _post_identifier → assert isinstance(expr, Literal) → AssertionError
```

Trigger: `analyze_structs()` hits the first struct member whose array length is an identifier (`Honk.Proof.pairingPointObject`, line 410). File-scope constants don't fold to `Literal`, so **every** identifier-length type position crashes — the 6 lines in the handoff notes are just the first struct sites; ~52 type positions total (13 struct members + ~39 signature/local sites). Because the crash fires during parsing, it kills the **entire** slither run (all detectors) → the analyzer's EVM slice reports incomplete → no complete EVM review of the SIP monorepo has been possible. This is the gate on (a) the first full dual-engine review and (b) the CodeRabbit side-by-side receipt.

Repro (2026-10-05, host slither 0.11.6, solc 0.8.28 via foundry): `slither src/verifiers/FundingVerifier.sol` → exit 1, AssertionError above. Log: `~/local-dev/tmp/slither-before.log`.

## Decision

Replace identifier-length **type positions** with their resolved literals. The file-scope constant *declarations* stay — loop bounds and length arithmetic are value positions and are unaffected by the `ArrayType` path.

| Expression in type position | Literal |
|---|---|
| `PAIRING_POINTS_SIZE` | `16` |
| `BATCHED_RELATION_PARTIAL_LENGTH` | `8` |
| `ZK_BATCHED_RELATION_PARTIAL_LENGTH` | `9` |
| `NUMBER_OF_ENTITIES` | `41` |
| `NUMBER_OF_SUBRELATIONS` | `28` |
| `NUMBER_OF_ALPHAS` (`NUMBER_OF_SUBRELATIONS - 1`) | `27` |
| `CONST_PROOF_SIZE_LOG_N` | `28` |
| `CONST_PROOF_SIZE_LOG_N - 1` | `27` |
| `ZK_BATCHED_RELATION_PARTIAL_LENGTH + 1` | `10` |
| `NUMBER_OF_ENTITIES + 9` | `50` |

Coverage rule: **every** `T[<ident…>]` type position is literalized — a partial fix only moves the crash to the next site (assert fires per-site in parse order). Non-goals: upstream Aztec template files, other verifiers (`grep` across `contracts/sip-ethereum/src` shows the pattern exists only in this file), the Anchor side.

## Verification (acceptance)

1. **Bytecode identity:** full `forge build` artifact-tree hash (via_ir, solc 0.8.28) identical before vs after — proves zero semantic delta; literals resolve to the same types solc already produced.
2. **The bot's exact EVM path:** `slither .` at the `contracts/sip-ethereum` foundry root (the `evm.sh` invocation shape) → exit 0, JSON report, no crash.
3. **Package tests:** `forge test` green (`FundingVerifier.t.sol`, `FundingVerifierE2E.t.sol` with the real fixture proof).
4. **Receipts:** the PR fires (a) rextor-audit[bot]'s first FULL dual-engine review on the monorepo and (b) `@coderabbitai review` (seat live) on the same diff → both comment sets captured as CWF receipts (marketing-matrix evidence; also captures live inline-comment rendering, teardown residual gap).

## PR mechanics

Local `git push` to sip-protocol 403s (keychain) → commit via GitHub Git Data API: blob → tree → commit → ref `fix/funding-verifier-constant-array-lengths` → PR. Author: rz1989s (a **human** author is required — CodeRabbit seat-gates bot-author dispatch; known issue from #1264). One commit, `fix(contracts): …`, no AI attribution.

## Status — live run 2026-10-05

- **PR:** [sip-protocol/sip-protocol#1267](https://github.com/sip-protocol/sip-protocol/pull/1267) — base `e5117f3`, commit `bcdf28e`, 1 file, +55/−55.
- **Branch verification:** slither completes standalone + at package root (125 findings, no crash); `forge test` 294/294; SIP CI green (`test` + `validate-circuits` check-runs on the head); **bytecode identity proven** via no-metadata A/B rebuild (`FOUNDRY_BYTECODE_HASH=none FOUNDRY_CBOR_METADATA=false`) — 112/112 artifacts byte-identical.
- **CodeRabbit receipt (A/B, their side):** auto-review on open — summary comment 11:52:09Z with Change Stack link, check context `CodeRabbit: success`, **zero inline findings** on the mechanical diff. Captured: `~/local-dev/tmp/outreach/cr-pr1267-summary.json`.
- **rextor-audit[bot] receipt: BLOCKED — webhook delivery never reached the service.** Evidence: `reviews` table last row 2026-09-29 (test repo), `skipped_deliveries` empty (nothing received-and-skipped), tunnel + service proven healthy externally (`https://webhook.rextoraudit.com/` returns the service's signature error JSON). Root cause (by elimination): the named tunnel has been up since **Sep 22 06:01** and the service since **Sep 29 17:43** — both were live at the 11:47 delivery time, the external path answers, yet no delivery arrived → **GitHub is not sending to `webhook.rextoraudit.com`; the App's webhook URL still points at a dead host** (the rotated quick-tunnel). "Restart the service/tunnel" is ruled out by those start times. **RECTOR manual:** App settings → Webhook URL → `https://webhook.rextoraudit.com`, then Recent deliveries → Redeliver the failed `pull_request` deliveries. Diagnostic dead end recorded: app-JWT introspection locally failed — `REXTOR_GITHUB_APP_PEM_PATH` signs a structurally valid JWT that GitHub rejects ("could not be decoded" = wrong key), and inline `REXTOR_AGENT_PRIVATE_KEY` is passphrase-encrypted PKCS#8 (service-only material).
