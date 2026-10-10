# CWF submission form — copy pack (drafted 2026-10-10, RECTOR pastes + attaches)

**Every claim below is receipt-backed.** Anchors: Tempo testnet `0x51ac…495a` (chainId 42431, reviewCount 20) · HyperEVM **mainnet** `0x8f63…850c` (chainId 999, reviewCount 3) · Solana devnet program `Aj6Nx…kMDs` · ERC-8004 agentId **50891**. Never claim Robinhood-chain attestation (config support only). Verify counts at submit time from https://www.rextoraudit.com/api/chain/tempo + `/api/chain/hyperliquid`.

---

## Project name

```
Rextor Audit
```

## One-liner (short description field)

```
PR-time audit agent: every pull request that touches money-code gets deterministic analysis, cited findings, a reproducible risk score, and a verdict anchored on-chain — verifiable by anyone, including your judges.
```

## Description (long field)

```
Rextor Audit is a GitHub App that turns every pull request into an audit event.

Static analysis (Slither + Foundry in a hermetic container) grounds the findings; an LLM pass triages and risk-scores the diff; every claim is pinned to cited lines from the actual diff — with a suggested fix diff the agent never applies itself. Silencing is single-channel: the owner's rextor.yaml on the base branch, every dismissal public with a reason. PR content can never silence its own findings.

Every verdict is attested on-chain: reviewId (keccak256 of repo|PR|headSha), commit hash, sha256 of the canonical findings JSON, risk score, and the chain the audited code targets. Anyone can recompute the hash from the public PR comment and call verify() — flip one byte and the contract says no. The full report is pinned to IPFS; its sha256 equals the on-chain hash.

Chain-native verdicts, chain-neutral identity: attestations live on Tempo (testnet registry 0x51ac…495a, 20 reviews) and HyperEVM mainnet (0x8f63…850c, 3 reviews), with a Solana devnet verdict program for Anchor PRs. The agent is registered under ERC-8004 (agentId 50891).

Tempo fit: CWF's flagship chain is exactly where our attestation registry runs — teams building money-code on Tempo this week can give their judges receipts verifiable on the same chain they're building on. Install is 2 minutes, free through the hackathon.

Audits are point-in-time. Code is continuous.
```

## Links

| Field | Value |
|---|---|
| Website | `https://www.rextoraudit.com` |
| GitHub | `https://github.com/rextorsec/rextor-audit` (public, MIT) |
| Demo video | `[RECTOR: paste final render link — hosting decision pending]` |
| Install | `https://www.rextoraudit.com/install` |
| Live receipts | `/api/chain/tempo` · `/api/chain/hyperliquid` · dashboard `/dashboard/rextorsec/rextor-audit-test` |

## Tracks (multi-select where the form allows)

1. **Tempo** — flagship: attestation registry is a deployed Tempo contract; invoice/incoming track narrative in description.
2. **Hyperliquid** — HyperEVM mainnet registry + attested tx (block 46562201).
3. **Solana** — Anchor PR reviews via Slither-for-Anchor + Solana devnet verdict program.
4. EVM riders (Eth L1 / Base / Arbitrum / Robinhood Chain): **config support — do NOT check a Robinhood track unless the form requires a working attestation there.**

## Deployed contracts / verification block (if the form has one)

```
Tempo testnet (chainId 42431): RextorAttestation 0x51ac8214089daf85b188437b087519acfc6c495a
  tx (A/B receipt, risk 100, 125 findings): 0x13be66d7eff4bec9afc51bcafb5be5c495c12c3f56aff19803e4411757f5f8c9
HyperEVM mainnet (chainId 999): RextorAttestation 0x8f63…850c · twin tx 0x64e2a131…1834b5 (status 0x1, block 46562201)
Solana devnet: verdict program Aj6Nx…kMDs (BPFLoaderUpgradeable)
ERC-8004: agentId 50891, identity-stake tx 0xc4c0565c…3d64, agentUri ipfs://QmcKWrvJvDEQinnUvUEd2v36ERF247QezssjfXEbc6QMAr
```

## Judge one-minute verify script (paste where the form allows extra material, or link the cast sheet)

```
cast chain-id --rpc-url https://rpc.moderato.tempo.xyz            # → 42431
cast keccak "rextor/review/v1|sip-protocol/sip-protocol|1267|f88a4831252bf34801881dc5f9bc3e8c353d141a"
cast call 0x51ac8214089daf85b188437b087519acfc6c495a \
  "verify(bytes32,bytes32,bytes32,string,uint16,uint16,uint8,uint32)(bool)" \
  <reviewId> <commitHash> <findingsHash> "<findingsURI>" 100 125 0 42431 \
  --rpc-url https://rpc.moderato.tempo.xyz                         # → true
# tamper one byte of findingsHash → false. Full sheet: repo docs/demo/cast-verify-sheet.md
```

## Team

```
RECTOR — sole founder/engineer. Rextor Security (rextorsecurity.com).
```

(Names/links per RECTOR's preference — fill at paste time.)

## Submission checklist (RECTOR)

- [ ] Video link live + watchable logged-out
- [ ] Judges/SSO note: rextoraudit.com is public, no SSO — nothing to disable (confirmed 2026-10-10)
- [ ] Re-verify `/api/chain/tempo` + `/api/chain/hyperliquid` counts at submit time
- [ ] Attach video if the form wants a file, not a link
- [ ] Submit before Oct 12 hard close
