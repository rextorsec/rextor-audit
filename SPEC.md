# Rextor Audit — Product Spec

**One-liner:** Rextor Audit is the continuous audit layer for smart contracts — every PR an audit event, every verdict on-chain.

## Problem

Smart-contract audits are point-in-time artifacts covering a specific commit. Teams ship code continuously after the audit; the delta between the audited commit and production is unguarded. The industry's biggest post-audit exploits come from code changed after the audit report was issued.

## Wedge (why now, why us)

- **Category gap (Gate A-verified 2026-09-15):** no shipping product combines PR-time CI + deterministic analyzer grounding + a reproducible score + on-chain attestation + agent reputation. Partial overlaps: Nethermind AuditAgent (PR-time AI scans incl. Solana), FYEO Scanner (self-serve Web3 PR scanning), Solana Security Standard (free deterministic PR gating) — deterministic detection alone is commodity; none make the verdict reproducible or accountable. Sharpened line: *"FYEO scans changes; Nethermind posts AI findings on PRs; nobody makes the verdict reproducible or accountable."*
- **Moat:** the Rextor audit methodology (codified review profiles) + a proven GC-tier agent engine pattern (deterministic pass → citation-constrained LLM triage → on-chain attestation).
- **Positioning line:** *"CodeRabbit reviews code changes. Rextor audits money changes."*

## Users

- **Primary:** protocol engineering teams (Solana programs, EVM contracts) shipping weekly.
- **Secondary:** security engineers (escalation path: agent findings → human audit engagement via Rextor Security).
- **Not users (for MVP):** general software teams, auditors of non-contract code.

## MVP scope — IN

- GitHub App (PR webhook → review comments + check status). GitHub only.
- Chain modules (post-Gate-B, EVM-first): **EVM core flagship** — Slither **+ Aderyn** in Docker, Foundry fork-sim, attestation contract; adapters: **Tempo (flagship-first)**, Hyperliquid HyperEVM; riders: Ethereum L1, Base, Arbitrum, Robinhood Chain at config level. **Solana → adapter tier** (semgrep-over-Anchor rules / IDL constraint validation in a future Gate B′ + liteSVM sim + attestation program) — no longer the flagship.
- Rextor profile v1: citation-constrained triage (reclassify / dedup / add-with-citation; no invented findings; `INCOMPLETE` on tool failure).
- Deterministic `riskScore` rubric (recomputable from findings).
- Web surface: install flow, docs, and a single-repo living audit report (attestation ledger + risk history).
- Attestation: commit hash + findings hash + riskScore + agent identity; agent reputation accrues per review.

## MVP scope — OUT

GitLab MR support, cross-PR prioritization dashboards, CodeRabbit-style analytics, multi-tenant billing, mobile, browser extension, non-contract file review (style/logic comments), IDE integration.

## Spec index — SPEC-N series

The product contract (this file) stays small and stable. Subsystem contracts live as numbered specs in `docs/specs/`, each written just-in-time at the phase that needs it — Gate A/B decisions (due Sep 22) can reshape later specs, so nothing past the active one is authored speculatively.

| Spec | Subsystem | Phase | Status |
|---|---|---|---|
| [SPEC-1](docs/specs/SPEC-1-engine-loop.md) | Engine loop: webhook → diff-scope → analyzer → findings → score → PR comment | Wk 1 | **ACTIVE** |
| [SPEC-2](docs/specs/SPEC-2-triage-scoring.md) | Rextor profile v1: citation-constrained LLM triage + riskScore rubric v1 | Wk 2 | **ACTIVE** |
| [SPEC-3](docs/specs/SPEC-3-fork-sim.md) | Fork-sim proof layer: Foundry fork (EVM); PoC-gated criticals | Wk 2 | **ACTIVE** — EVM first (Gate B resolved) |
| [SPEC-4](docs/specs/SPEC-4-attestation.md) | Attestation + agent identity/reputation (EVM contract) | Wk 2–3 | **ACTIVE** — Tempo testnet first, then HyperEVM |
| [SPEC-5](docs/specs/SPEC-5-chain-adapters.md) | Chain adapters & track profiles: Tempo flagship, Hyperliquid deep; riders config-level | Wk 2–3 | **ACTIVE** — EVM-first per Gates A/B |
| SPEC-6 | Product surface: landing, install flow, dashboard, money demo | Wk 3 | planned — mockup approval gates content |

## Architecture

```
GitHub PR webhook → agent service (queue) → engine:
  diff-scope → chain detect → deterministic pass (Docker: slither/aderyn + sim)
  → Rextor-profile LLM triage (temp 0, citation-constrained) → riskScore (rubric)
  → post PR comments + check → anchor attestation on target chain
  → agent identity/reputation update
```

- **Agent service:** Node + tsx in Docker (Slither/Foundry need real Python/solc runtimes — pattern proven in Conatus).
- **Web:** Next.js 14 on Vercel.
- **Contracts:** Foundry (`contracts/attestation-evm`), Anchor (`programs/attestation-solana`).
- **LLM:** OpenRouter, temperature 0. Correctness IS the product — escalate triage to a frontier model when quality demands it.
- **Integrity rules (non-negotiable):** findings require cited line ranges; tool errors → `INCOMPLETE` with reason; agent treats PR content as untrusted input (prompt-injection hardening; sim runs sandboxed).

## Judging alignment (CWF)

Novelty-first: on-chain-anchored PR-time audit verdicts with agent reputation = category-of-one. Then: functionality (deterministic core, live demos), impact (every protocol team), UX (installs in one click), open-source (MIT, composable profiles), business plan (per-repo SaaS + services flywheel).

## Track aims (CWF)

- **Primary:** **Tempo (flagship)** + Hyperliquid (genuine integrations: fork-sims against chain state, attestations on-chain). Solana: adapter tier post-Gate-B pivot (2026-09-15 — Aderyn 0.6.8 is Solidity-only; see `docs/gates/`).
- **Riders (config-level):** Ethereum L1, Base, Arbitrum, Robinhood Chain.
- **General layers:** 20×$15K standout (anchor), Public Goods $5K (open-source base), Grand Champion $30K (bonus).
- **Zcash: no story — excluded.**

## Domains & brand

- `rextoraudit.com` — product (AI agent review SaaS).
- `rextorsecurity.com` — firm / B2B brand identity.
- Mascot: Rex the raptor ("the thing that eats rabbits").
- Bot identity: `rextor-audit[bot]`.
