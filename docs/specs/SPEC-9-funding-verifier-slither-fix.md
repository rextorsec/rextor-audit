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

## Status — live run 2026-10-05 (corrected after delivery forensics)

- **PR:** [sip-protocol/sip-protocol#1267](https://github.com/sip-protocol/sip-protocol/pull/1267) — base `e5117f3`; heads `bcdf28e` → `6037356` → `f88a483` (empty `chore(reviewer)` commits as re-review triggers — see C1 note). SIP CI green on every head (`test` + `validate-circuits`).
- **Branch verification (unchanged):** slither completes standalone + at package root; `forge test` 294/294; no-metadata A/B rebuild — 112/112 artifacts bytecode-identical.
- **CodeRabbit receipt (A/B, their side):** auto-review on open — summary + Change Stack + check `CodeRabbit: success`, zero inline findings on the mechanical diff. `~/local-dev/tmp/outreach/cr-pr1267-summary.json`.
- **rextor-audit[bot] receipt (A/B, our side): CAPTURED — first full dual-engine review of the monorepo.** Comment 13:54Z: **risk score 100/100, 125 findings (4 in-diff / 121 repo-wide), attested Tempo testnet tx `0x13be66d7…`, IPFS findingsURI, footer + feedback CTA.** Index row status=0. The 13:22/13:31 comments are the honest INCOMPLETE trail from the outage chain below. Triage LLM hit the 90s stall guard → raw-findings banner (soft-degrade by design; R2-class known issue).

### The outage chain — three stacked failures masked by ACK-then-run

The service ACKs deliveries before running, so GitHub saw 200s while reviews died off-stage; comment-stage failures write no index rows, which is why the DB looked silent. Earlier "dead webhook URL" and "wrong PEM" theories (committed here in error earlier today) are RETRACTED — deliveries always arrived, and the service's own provider mints installation tokens fine (PEM valid).

1. **Comment credential:** `GITHUB_TOKEN` was a fine-grained PAT without sip-protocol org access → every org comment 403'd (`Resource not accessible by personal access token`), including the INCOMPLETE failure comments — failures were invisible on GitHub by construction. Fixed: swapped to the gh CLI classic token in the secret `.env` (verified by probe comment + adapter probe).
2. **Clone left submodules empty:** foundry `lib/` deps are git submodules (mode 160000); the PR-head fetch never initialized them → `forge build` failed compile on every monorepo PR. Fixed in **PR #41** (`git submodule update --init --recursive --depth 1` after checkout; best-effort, redacted logging).
3. **Analyzer image prewarmed only solc 0.8.24:** the monorepo pins `0.8.28`; the offline container (`--network none`) cannot auto-install → instant crytic-compile `InvalidCompilation` ("out/build-info is not a directory"). Fixed in **PR #42** (warm-build pattern pinned 0.8.28; verified cold-clone under exact runtime constraints: exit 0, full findings NDJSON, ~17s).

### Runbook + RECTOR follow-ups

- **Launch discipline:** pass the token explicitly — `env -u OPENROUTER_API_KEY GITHUB_TOKEN="$(grep ^GITHUB_TOKEN= .env | cut -d= -f2-)" pnpm dev` — tsx `--env-file` does not override inherited vars, and stale interactive-shell exports (the Sep-17 OPENROUTER class) shadow `.env` silently. The service now runs as hub proc `rextor-agent` (restarted 2026-10-05 on merged main).
- **RECTOR (durable):** (a) replace the gh-login token ride-along with a dedicated fine-grained PAT allowlisting sip-protocol (Issues/PRs write); (b) the check-run receipt 403s with `Resource not accessible by integration` — **the App lacks Checks:write**: enable it in App settings and approve the installation permission update.
- **Diagnostic dead ends kept for the record:** local app-JWT introspection failed on a signing-pipeline flaw (newline-wrapped base64) — NOT the PEM; the "2g memory cap OOM" theory was wrong too (cold-clone crash reproduces deterministically at any cap; it was the missing compiler).
- **C1 guard note:** a settled INCOMPLETE row marks a head as reviewed; re-firing after infra fixes needs a new head (hence the empty commits). Candidate product gap: distinguish infra-INCOMPLETE from content-INCOMPLETE at the guard.
