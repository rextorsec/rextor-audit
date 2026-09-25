# Judges' comparison matrix — PR-time smart-contract audit tools

**Audience:** CWF judges. **Date:** 2026-09-25. **Method:** public product pages, docs, repos, and our own live artifacts only. Claims about competitors say "not evidenced on public pages as of 2026-09-25" rather than "cannot" — absence of evidence is noted as such. Every Rextor receipt is independently checkable (links + chain reads).

---

## The three-way matrix

| Dimension | CodeRabbit | Conatus (our prior build) | **Rextor Audit** |
|---|---|---|---|
| Scope | Whole-repo PR review, all languages | Single-file paste audit | **PR-time, diff-scoped, money-code focused** |
| Deterministic grounding | LLM throughout [not evidenced: static analyzers] | — | **Slither + Aderyn in containers; LLM never sees findings before normalization** |
| Findings citation | AI summary + inline comments | Report text | **Citation-constrained: every claim pinned to cited diff lines, per-file line maps** |
| Proof by execution | ✗ Verify stage reads evidence, never executes [public docs, 2026-09-18] | — | **Fork-sim: generated PoC executes against a pinned fork block; confirmed ≠ unproven, attested** |
| Risk score | None published [as of 2026-09-25] | Rubric-scored | **Deterministic 0–100, published rubric, temp 0, recomputable** |
| Integrity on failure | Inconclusive states reported (converged posture) | — | **Analyzer failure ⇒ INCOMPLETE report — never a silent clean pass; gate reads raw analyzer severities (LLM can't flip)** |
| On-chain accountability | ✗ dashboard-bound | ✅ Mantle mainnet verdicts, ERC-8004 #115, IPFS, published rubric — **won $17.5k on this pattern** | ✅ **Tempo testnet (8 reviews) + HyperEVM MAINNET + Solana devnet verdicts; `verify()` recomputable by anyone; IPFS-pinned reports; ERC-8004 agentId 50891** |
| Silencing model | config in repo | — | **Server-side, repo-keyed, public reasons — PR content can never silence its own findings** |
| Operational loop | GitHub App (mature, multi-platform) | None (paste tool) | GitHub App + webhook queue, chat-in-PR, severity-gate check-runs, live dashboard |
| Price model | per-seat $24–90/mo (Security folded into Advanced tier 2026-09 — verifying) | n/a | **per-repo, anchored on audit-engagement economics** |

**Read:** CodeRabbit wins breadth and platform maturity — we don't contest it. Conatus proved the accountability pattern wins judges; Rextor is that pattern upgraded to the PR-time loop Conatus lacked: diff scope, execution proof, multi-chain verdicts, integrity rails.

## Other entrants scanned (Gate A, 2026-09-15; spot re-checked 2026-09-25)

| Tool | What it has | What's absent on public pages |
|---|---|---|
| FYEO Scanner | Self-serve PR-time Web3 scanning, credits | Deterministic analyzer grounding; reproducible score; attestation |
| Nethermind AuditAgent | GitHub Actions PR scans incl. Solana | CI tier self-described as "lighter"; no reproducible score; no attestation |
| Solidity Prism | Slither+Aderyn+Mythril+AI on PRs (EVM) | On-chain verdicts; Solana; multi-chain native receipts |
| ChainGPT | One-shot LLM audits | PR-time hooks; deterministic grounding |
| OpenAudit (OSS) | 100+ skill pipelines, on-demand, local | Product surface: no app, no webhook, no scoring, no attestation |
| Solana Security Standard | 52 deterministic Solana PR rules, free, SARIF gate | AI triage; scoring; attestation — our Solana slot extends it with on-chain verdicts |

## Rextor receipts a judge can check in one minute

1. `cast call 0x51ac8214089daf85b188437b087519acfc6c495a 'reviewCount()(uint256)' --rpc-url https://rpc.moderato.tempo.xyz` → 8 (Tempo testnet, 42431)
2. Same on HyperEVM mainnet: registry `0x8f63c0581ab3b2836c95f97fcf104d2dd962850c` (chain 999) — twin of review `0xb0644c0e…` confirmed at block 46,562,201
3. Solana devnet: program `Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs` executable
4. Live identity reads: https://www.rextoraudit.com/api/chain/tempo · `/api/chain/hyperliquid`
5. Living audit report: https://www.rextoraudit.com/dashboard/rextorsec/rextor-audit-test

*All chain facts re-verified 2026-09-25 (docs/demo/script.md annex has the full sweep).*
