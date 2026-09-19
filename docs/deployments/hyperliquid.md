# RextorAttestation — HyperEVM testnet deployment (PREPARED — broadcast is RECTOR-gated)

**Deploy #2 (primary track) — SPEC-4 §2.** Contract v2 (findingsURI + targetChainId) deploys **directly** here — no v1 history on this chain. This doc is a prepared record: all fields present, values **pending-deploy** until RECTOR's Step-2 broadcast lands. Pattern mirrors [`tempo.md`](tempo.md) (deploy #1).

## Deployment record — PENDING-DEPLOY

| Field | Value |
|---|---|
| Contract | [`RextorAttestation`](../../contracts/attestation-evm/src/RextorAttestation.sol) (immutable **v2**: `findingsURI` ≤256B, `targetChainId`) |
| Address | `pending-deploy` |
| Chain | HyperEVM testnet, chainId **998** (`0x3e6`) |
| RPC | `https://rpc.hyperliquid-testnet.xyz/evm` — **the `/evm` path is required**; the bare domain 404s (verified live 2026-09-18) |
| Deploy tx | `pending-deploy` |
| Block | `pending-deploy` |
| Gas used | `pending-deploy` (fixed `--gas-limit` per runbook below) |
| Deployer / owner | `pending-deploy` — expected `DEPLOY_PRIVATE_KEY` from the secret-store `.env` (same key as Tempo deploy #1 unless RECTOR says otherwise) |
| Attest agent | `pending-deploy` — expected `REXTOR_AGENT_PRIVATE_KEY` address, registered + active |
| registerAgent tx | `pending-deploy` |
| Contract commit | this commit (`feat/attestation-v2`) — v2 source (`findingsURI`/`targetChainId`, SPEC-4 errata) |
| Explorer | none verified for testnet — registry `explorer` stays `null`; probe live at pre-flight (e.g. hyperevmscan.io is mainnet; a testnet instance was not resolvable 2026-09-18) |

After broadcast: fill this table, then fill the registry slot `packages/agent/src/chains.ts → CHAIN_REGISTRY.hyperliquid.attestation` with the verified address + chainId 998 (it **stays null until then** — invariant 16 fail-loud), and update the `docs/track-profiles.md` row. Extend `chains.test.ts` completeness to pin the literal.

## Fee model — verified from Hyperliquid docs (do NOT assume pathUSD)

- **Gas token: HYPE** (native, 18 decimals). pathUSD is **Tempo-only**; there is no equivalent fee-credit token here. Verify live at pre-flight: `cast balance <broadcaster>` must be nonzero HYPE.
- Standard **EIP-1559** (Cancun, no blobs); base fees and priority fees are both burned. No Tempo-style TIP-1000 state-creation premiums are documented — **verify live at pre-flight** whether `eth_estimateGas` is trustworthy (Tempo's estimates lied; this chain may not share that behavior — see tempo.md gotcha 1), but the runbook keeps the fixed-limit pattern anyway (cheap insurance, costs nothing to over-provision).
- Error code `10055` = HyperCore↔HyperEVM boundary errors (nonce, insufficient funds, duplicate tx hash, underpriced replacement).
- Pre-EIP-155 txs are accepted but discouraged.

## Pre-flight checklist (RECTOR, before broadcast)

1. **RPC reachable + correct chain:** `curl -s -X POST https://rpc.hyperliquid-testnet.xyz/evm -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'` → `"0x3e6"`. (Bare domain 404s — use `/evm` everywhere, including the profile below.)
2. **Funding — VERIFY LIVE, sources not independently confirmed:** gas is HYPE. Candidate paths:
   - Official drip <https://app.hyperliquid-testnet.xyz/drip> (docs: requires a mainnet deposit with the same address; documented to give mock USDC on HyperCore — **verify whether it drips HYPE**).
   - HYPE sits on HyperCore first; move it to HyperEVM by sending to the system address `0x2222222222222222222222222222222222222222` (docs: hyperevm.md, Native Transfers — **verify the testnet flow behaves the same**).
   - Community faucets exist but are untrusted — verify provenance before use.
   - Confirm with: `cast balance <deployer> --rpc-url https://rpc.hyperliquid-testnet.xyz/evm` > 0.
3. **Ops keys loaded from the secret-store `.env`** (`DEPLOY_PRIVATE_KEY`, `REXTOR_AGENT_PRIVATE_KEY`, `REXTOR_AGENT_NAME`) — export into the shell before `forge script` (this foundry build reads **no** env key for `forge create`/`cast send` — tempo.md gotcha 4 applies here too; never `--private-key` argv, it leaks via `ps`).
4. **Fee-token sanity:** `cast balance` (HYPE) nonzero — do not look for pathUSD or a Tempo-style `tempo_fundAddress` drip; none exists here.
5. **Chain head moving:** `cast block-number --rpc-url https://rpc.hyperliquid-testnet.xyz/evm` twice — confirm the testnet is producing blocks before burning a nonce.

## Runbook — Step 2 broadcast (RECTOR-gated; NOT executed in prep)

From `contracts/attestation-evm/`, secrets exported:

```sh
# 1) Deploy v2 (fixed gas limit + skip-simulation, tempo.md gotcha 2 pattern;
#    5M is ~5x a plain CREATE — raise if OOG, no premiums documented here)
FOUNDRY_PROFILE=hyperliquid forge script script/Deploy.s.sol \
  --broadcast --slow --skip-simulation --gas-limit 5000000

# 2) Capture from output, then record: contract address, tx hash, block.
cast receipt <deploy-tx> --rpc-url https://rpc.hyperliquid-testnet.xyz/evm

# 3) Register agent (owner-only ops call) — same fixed-limit pattern
export REXTOR_ATTEST_CONTRACT_ADDRESS=<deployed-address>
FOUNDRY_PROFILE=hyperliquid forge script script/Register.s.sol \
  --broadcast --slow --skip-simulation --gas-limit 1000000

# 4) Smoke-verify (mirror tempo.md smoke section, then fill the table above)
cast call <address> "owner()(address)" --rpc-url https://rpc.hyperliquid-testnet.xyz/evm
cast call <address> "agents(address)(string,bool,uint64)" <agent-addr> --rpc-url https://rpc.hyperliquid-testnet.xyz/evm
cast call <address> "verify(bytes32,bytes32,bytes32,string,uint16,uint16,uint8,uint32)(bool)" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  0x0000000000000000000000000000000000000000000000000000000000000000 "" 0 0 0 0 \
  --rpc-url https://rpc.hyperliquid-testnet.xyz/evm   # expect false — unknown reviewId rejects
```

Env the scripts read (all via `vm.env*`, no argv keys): `DEPLOY_PRIVATE_KEY`, `REXTOR_ATTEST_CONTRACT_ADDRESS`, `REXTOR_AGENT_PRIVATE_KEY`, `REXTOR_AGENT_NAME`.

## Gotchas to carry back (live-verify items)

1. **RPC must be the `/evm` path** — verified 2026-09-18: bare `rpc.hyperliquid-testnet.xyz` returns 404 (nginx); only `…/evm` serves JSON-RPC. The foundry profile and the registry both carry the `/evm` URL.
2. **No verified testnet explorer** — if RECTOR finds one live, record it here and fill the registry `explorer` slot (footer omits the link until then).
3. **EstimateGas honesty unknown** (unlike Tempo's premiums) — first broadcast keeps `--skip-simulation --gas-limit` regardless; if the fixed 5M lands first try, note actual usage and whether plain estimates would have sufficed (feeds the next chain's runbook).
4. **Faucet path is the least-verified step** — official drip is documented around mock USDC; HYPE-on-HyperEVM acquisition must be confirmed live at pre-flight (checklist item 2).
