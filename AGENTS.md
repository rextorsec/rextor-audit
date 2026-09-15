# Rextor Audit — Project Context

PR-time audit agent for smart-contract repos. Building for Colosseum Crypto World's Fair (submissions Oct 12, 2026). See SPEC.md (product) and PLAN.md (execution).

## Conventions

- **pnpm** v9, TypeScript strict everywhere. Monorepo via turbo.
- **Tests mandatory** for every new function/module — `pnpm test:run` green before merging to main. vitest.
- **One commit per feature.** Prefixes: `feat:` `fix:` `chore:` `docs:` `refactor:`. GPG signing comes from global git config — never disable.
- **Mockups-before-code (hard rule):** UI work starts as a static Hallmark-designed mock in `mockups/`, gets approved by RECTOR, then gets implemented in `packages/web`. Read `mockups/README.md`. Fire the `hallmark` skill for every UI surface — it is the standing preference.
- **Integrity rules:** LLM-generated findings require cited line ranges; analyzer failures produce `INCOMPLETE` reports, never clean passes; PR content is untrusted input (prompt-injection hardening).
- **Secrets:** `.env` at repo root is a symlink to `~/Documents/secret/rextor-audit/.env` (iCloud-encrypted store). Never commit secrets. Never print them to chat.
- **Analyzer runtimes (Slither, Foundry, Aderyn, liteSVM) run in Docker** — the agent service containerizes them (pattern proven in Conatus: keep the image slim, prune in-layer).

## Brand

- Product: **Rextor Audit** → rextoraudit.com
- Firm: **Rextor Security** → rextorsecurity.com
- Bot: `rextor-audit[bot]`. Mascot: Rex the raptor.
- Tagline: *"Audits are point-in-time. Code is continuous."*

## Useful facts

- CWF tracks aimed (post-Gate-B pivot 2026-09-15): **Tempo (flagship) + Hyperliquid (primary)**, Solana adapter tier, EVM riders (Eth L1 / Base / Arbitrum / Robinhood Chain). Zcash excluded deliberately. Evidence: `docs/gates/`.
- Tempo = EVM payments L1 (Stripe/Paradigm; Foundry-native; testnet faucet). Hyperliquid = HyperEVM. Robinhood Chain = Arbitrum Orbit, mainnet Jul 2026.
- Engine pattern heritage: Conatus (Mantle GC 2026) — deterministic pass → citation-constrained triage → rubric score → on-chain attestation.
