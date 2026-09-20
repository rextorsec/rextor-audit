# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities in rextor-audit **privately** to
**rector@rectorspace.com** — please do not open public issues for them.
Include reproduction steps, affected commits, and impact.

## Intentionally-public credentials — do not report

This repository deliberately contains two classes of canonical, public-by-design
credentials. They are not exposures and cannot be rotated from our side:

1. **forge-std default chain RPCs** — vendored copies of Foundry's standard
   library (`lib/forge-std/`, `vendor/forge-std/`) ship upstream's built-in
   defaults, including the public Infura sample key
   `https://sepolia.infura.io/v3/b9794ad1ddf84dfb8c34d6bb5dca2001`
   (`StdChains.sol` / `StdChains.t.sol`). The vendored trees are byte-identical
   to upstream `foundry-rs/forge-std` — see
   `contracts/attestation-evm/PROVENANCE.md`. The key belongs to Infura's
   public sample pool and is distributed to every Foundry project.
2. **Anvil/Hardhat dev keys** — test files and planning docs use the well-known
   local-development private keys (e.g. `0xac0974bec39a…f2ff80`,
   `0x59c6995e998f…78690d`). These are printed by every local node at startup
   and have zero value outside a throwaway local testnet.

Automated secret scanners: these patterns are allowlisted in `.gitleaks.toml`.
Reports consisting solely of the above will be closed as false positives.

## Secret handling

Real credentials (GitHub tokens, OpenRouter keys, agent wallets, Pinata JWT)
never live in this repository. `.env` is a gitignored symlink into an
out-of-repo secret store; `.env.example` documents the required variables with
placeholder values only. Production RPC endpoints and signer keys are injected
at runtime.
