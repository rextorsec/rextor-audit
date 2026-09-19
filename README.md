# Rextor Audit

> **Audits are point-in-time. Code is continuous.**

Rextor Audit is a PR-time audit agent for smart-contract repositories. Every pull request that touches money-code becomes an audit event: diff-scoped static analysis, fork-simulation against live chain state, methodology-driven LLM triage, a deterministic risk score — and the verdict anchored on-chain, keyed to the commit.

Built by [Rextor Security](https://rextorsecurity.com) — practicing auditors. The methodology that reviews the code is the same one we hunt bugs with.

- **Product:** https://rextoraudit.com (planned)
- **Firm:** https://rextorsecurity.com (planned)
- **Status:** pre-alpha — building for the Colosseum Crypto World's Fair (submissions due Oct 12, 2026)

## What it does

On every PR to a Solana program or EVM contract repo:

1. **Scope** — diff → changed functions, new callsites, trust-boundary deltas
2. **Deterministic pass** — Slither / Aderyn-class analyzers + fork simulation (liteSVM, Foundry fork)
3. **Rextor-profile triage** — LLM constrained to comment only with cited line ranges; tool failures mark the report `INCOMPLETE`, never a fabricated clean pass
4. **Verdict** — deterministic rubric → `riskScore`, recomputable by anyone from the findings
5. **Anchor** — attestation on-chain: commit hash + findings hash + agent identity + reputation

Agent identity: canonical ERC-8004 registry, `agentId 50891` on `eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` — mint tx [`0xc4c0565c1f07e42cbd9524dadc7a033079ac0d4f7d497cb70abd7ba0dcec3d64`](https://etherscan.io/tx/0xc4c0565c1f07e42cbd9524dadc7a033079ac0d4f7d497cb70abd7ba0dcec3d64); chain-native verdicts on Tempo (`0x7fe6…0bcd`) and Solana devnet (`Aj6Nx…kMDs`).

## Status

See [SPEC.md](./SPEC.md) for the product spec and [PLAN.md](./PLAN.md) for the execution plan.

## License

MIT — see [LICENSE](./LICENSE).
