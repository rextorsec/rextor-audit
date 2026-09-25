# CWF Submission Draft — Colosseum Crypto World's Fair

**Status:** DRAFT for RECTOR review. Everything factual is verified against the repo/chains on 2026-09-25; fields marked `⟨YOUR …⟩` need identity/socials only you have. Submissions close **Oct 12, 2026 11:59 PM PDT** — internal target Oct 10.

---

## Core fields

**Project name:** Rextor Audit

**Tagline:** Audits are point-in-time. Code is continuous.

**One-line description (≤280 chars):**
> Continuous smart-contract auditing for every PR — deterministic analysis (Slither + Aderyn), fork-sim proof-of-concepts, reproducible risk scores, and verdicts anchored on-chain. Every pull request an audit event.

**Long description:**
Traditional audits cover one commit; everything after ships unguarded, and the biggest exploits of every cycle are deltas — code that changed after the report. Rextor Audit is a GitHub App that reviews every PR touching money-code: static analysis grounds the findings, an LLM triage layer enforces citation discipline (every claim pinned to cited diff lines — no model vibes), a fork-sim harness attempts a runnable PoC for criticals on a pinned fork block, and a reproducible 0–100 risk score lands as a PR comment. The verdict — findings hash, reviewId, IPFS-pinned report — is attested on-chain, where anyone can recompute the hash from the public report: flip one byte and the contract says no. Dismissals live server-side in a repo-keyed store with public reasons; PR content can never silence its own findings. Analyzer failures produce INCOMPLETE reports, never clean passes.

**Website:** https://www.rextoraudit.com
**Demo video:** ⟨YOUR — pending; script in red-pen (`docs/demo/script.md`), receipts pre-verified 09-25⟩
**GitHub:** https://github.com/rextorsec/rextor-audit (public, MIT)
**Twitter/X:** ⟨YOUR⟩ · **Telegram/Discord:** ⟨YOUR⟩ · **Contact email:** rector@rectorspace.com

**Team:** RECTOR — founder, solo. ⟨YOUR bio line⟩

**Stage:** Live product in production (public site + production GitHub App smoke runs); pre-revenue.

## Track selection (CWF tracks we're aimed at)

- **Tempo (flagship)** — attestations live on Tempo testnet, registry `0x51ac…495a` (chainId 42431), 8 reviews attested.
- **Hyperliquid (primary)** — attestation registry deployed on **HyperEVM mainnet** `0x8f63…850c`; mainnet twin tx confirmed (block 46,562,201).
- **Solana adapter tier** — verdict program live on Solana devnet (`Aj6Nx…kMDs`, executable, upgradeable-loader).

## Receipts (all re-verified live 2026-09-25)

| Claim | Receipt |
|---|---|
| Attestation contract, Tempo | registry code live on 42431; txs `0x56311f293f…` (block 36628648), `0x4a2a834416…`, `0x1323a45515…` all confirmed to registry |
| Attestation contract, HyperEVM mainnet | registry code live on 999; twin tx `0x64e2a131…1834b5` status 1 |
| Public verifiability | live identity reads: `/api/chain/tempo` → `active:true, reviewCount:8`; `/api/chain/hyperliquid` → `active:true, reviewCount:1` |
| Agent identity | ERC-8004 agentId **50891**, identity card live on landing |
| Solana verdicts | program executable on devnet |
| Dashboard | living audit report at `/dashboard/<owner>/<repo>` — 16-row ledger |

## What makes it different (judges' lens)

1. **Point-in-time vs continuous** — the audit becomes a stream, not a PDF.
2. **Reproducible, not vibes** — findings hash recomputable by anyone from the public report; `verify()` answers true/false on-chain.
3. **Fork-sim proof** — criticals carry a PoC that actually runs against a pinned fork block, not a description.
4. **Integrity by construction** — INCOMPLETE on analyzer failure; server-side dismissals; PR content can't silence findings; gate reads raw analyzer severities.
5. **Chain-native verdicts, chain-neutral identity** — ERC-8004 identity, per-chain attestations.

## Honest boundaries (never overclaim)

- EVM rider tracks (Ethereum/Base/Arbitrum/Robinhood): config-level support, no native attestation deploys yet.
- Robinhood chain params recorded as null until integration — never fabricated.
- Demo video + rextorsecurity.com DNS pending at draft time.

## Pre-submit checklist

- [ ] Demo video recorded (script red-pen → receipts already verified → shoot)
- [ ] `⟨YOUR⟩` fields filled
- [ ] rextorsecurity.com DNS live (or submit with product domain)
- [ ] Final receipt re-verification sweep (rerun the 09-25 checks) ≤24h before submit
