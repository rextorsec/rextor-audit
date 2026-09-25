# R6/E2 — Verdict-quality receipt on a fresh PR

**Date:** 2026-09-25/26 · **Trigger:** [rextor-audit-test#9](https://github.com/rextorsec/rextor-audit-test/pull/9) (fresh branch `feat/e2-verdict-receipt`, fixture `src/PaymentPool.sol` — deliberate reentrancy high + missing zero-check low). **Model:** `z-ai/glm-5.3-flash` @ temp 0. E2 rule honored: fresh PR only.

---

## Run A — the integrity receipt (analyzer image missing)

The first review ran while the local `rextor/analyzer` image was absent (pruned daemon). Result: **INCOMPLETE comment, no score, analyzer error quoted verbatim, review attested `status=1`** ([tx `0xbdbbc7a8…`](https://rpc.moderato.tempo.xyz)).

> *"Tool failure is never reported as a clean pass (SPEC-1 integrity)."*

This is the diff vs every LLM-audit wrapper we scanned: the failure mode is a visible, attested INCOMPLETE — not plausible prose.

## Run B — complete review (image restored, fresh head `a414a62`)

| Stage | Output | Receipt |
|---|---|---|
| Analyzers (Slither + Aderyn) | 7 deterministic findings (reentrancy-eth ×2, missing-zero-check ×2, low-level-calls ×3, immutable-states ×1) | findings JSON in comment, descriptions verbatim from analyzer |
| LLM triage (citation-constrained) | `0 dedup · 0 reclassify · 1 added · 2 suggest` — added `rextor/missing-zero-check` (#7), kept analyzer severities (gate input) | ops line printed in comment |
| Risk score | **68/100**, deterministic rubric | comment banner |
| Severity gate | check-run `rextor-audit` = **failure** (high present) | [head check-run](https://github.com/rextorsec/rextor-audit-test/pull/9) |
| Fork-sim | PoC generation **failed** (LLM body-stall guard, 90s) → eligible findings `poc:unproven`, visible note — never guessed | simNote in comment |
| Fix diffs | 2 suggestions; #0 is textbook checks-effects-interactions (clear `credits` before call) | comment diff blocks |
| Attestation | Tempo tx [`0x8b727ca4…446`](https://rpc.moderato.tempo.xyz), reviewId `0xa4df9e39…63d4`, IPFS `ipfs://QmZZqVaw…` | comment footer + index row |
| Learnings ledger | recurring rules annotated ("fired 2×/3×/4× in this repo") | note column |

## The recomputation proof (what no competitor offers)

From the **public comment alone**, no repo access, no bot trust:

```
$ sha256(findings JSON line)  →  0x4ef73f35bf0fedddf43a64511ef9fd5fb7df3ad87b056e1cda961df74d4cdab8
$ verify(0xa4df9e39…, commit, findingsHash, uri, 68, 8, 0, 42431) on Tempo 0x51ac…495a  →  true
```

Both recomputed live 2026-09-26. **MATCH ✓ / verify true ✓.**

## Baseline comparison (R6 deliverable)

| What a plain Slither/Aderyn Action gives | What this run gave |
|---|---|
| Raw detector warnings, no ranking | 0–100 deterministic score + severity gate check-run |
| No fix suggestions | 2 reviewable diff blocks, labeled "review before applying" |
| No cross-run memory | learnings ledger (recurrence annotations) |
| No failure semantics (silent exit 0) | attested INCOMPLETE on tool failure (Run A) |
| No accountability | on-chain verdict, publicly recomputable hash, IPFS report, ERC-8004 identity |

## Observed caveats (kept honest)

1. **PoC sim stalled** — glm-5.3-flash body-stall (2nd occurrence this week). The guard degraded correctly, but a frontier PoC-generator would likely have produced a `confirmed` (the reentrancy is trivially exploitable). Evidence for the E2 model-flip decision, deferred to RECTOR.
2. **Scope observation** — 4 of 8 findings cite `src/Vault.sol`, which this PR did not touch (only `src/PaymentPool.sol` did). The comment claims "in changed contract code." Either scopeDiff widened or the finding normalization predates scoping — needs a look (tracked, non-blocking; the gate consumed the in-scope high correctly).
3. App-hook `redeliveries` endpoint returned generic 404 (id precision handled; API-version header set) — re-review via `synchronize` push instead. Documented for ops.

## Verdict

One fresh PR, one integrity artifact (Run A), one complete attested verdict (Run B), and a publicly recomputable proof chain — the exact demo §4 needs.
