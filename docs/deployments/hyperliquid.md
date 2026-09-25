# RextorAttestation — HyperEVM deployment

**Deploy #2 MAINNET (chain 999) — recorded 2026-09-21. This is the LIVE deployment.** The testnet runbook below is preserved as history + gotchas; the faucet-gated testnet was abandoned in favor of mainnet receipts.

| Field | Value |
|---|---|
| Contract | [`RextorAttestation`](../../contracts/attestation-evm/src/RextorAttestation.sol) (immutable **v2**: `findingsURI` + `targetChainId`) |
| Address | `0x8f63c0581ab3b2836c95f97fcf104d2dd962850c` |
| Chain | HyperEVM **mainnet**, chainId 999 (`0x3e7`) |
| RPC | `https://rpc.hyperliquid.xyz/evm` (state-at-latest races on the official RPC → broadcast via `https://hyperliquid.drpc.org`) |
| Deploy tx | `0xe30c482464a0304407969ab2fd3acaba632c9121e9c1fd8b00deab7eb7d989a4` (block 46,469,870) |
| Gas used | 1,396,058 @ 0.141 gwei eff. = **0.000197 HYPE** (~$0.018) — E1 receipt via `scripts/fee-review.ts` |
| Deployer / owner | `0x273ae839a5447CEE34b9a694Bb62C9e61086d76d` (post-rotation owner key) |
| Attest agent | `0x5f2b9C1549F7e178dC0cC15FdCf3719c9fb47f37` — registered as `rextor-audit`, **active** |
| Contract commit | `d026478`+ (Gate B mainnet) |
| Explorer | `https://hyperevmscan.io` (mainnet) |

## Mainnet verification (2026-09-21)

- `agents(0x5f2b…47f37)` → `("rextor-audit", true, 0)` — registered, active.
- `verify(unknown reviewId …)` → `false` — unknown reviewId rejects.
- Funding: 0.051 HYPE sent to the owner (deBridge: Solana USDC → HYPE on HyperEVM, recipient = owner — no forwarding hop). At current 0.1 gwei this covers Gate B + **hundreds of attestations**.

## Native twins (2026-09-25, CWF demo-week)

Records proven against Tempo `verify()` = true first (exact tuples from the published PR footers), then attested natively — agent-side read-back `verify true` each:

| Review | Source tx (Tempo) | Twin tx (HyperEVM mainnet) | Cost |
|---|---|---|---|
| `0xb0644c0e…` (pr 8, 90/100) | `0x56311f293f…` block 36628648 | [`0xeb16eb40a4a428cab93f7a3e6404d71acf729ce5c5c1e8c2b6bfe099d69864a7`](https://hyperevmscan.io/tx/0xeb16eb40a4a428cab93f7a3e6404d71acf729ce5c5c1e8c2b6bfe099d69864a7) | 0.0000194 HYPE |
| `0x82f4bb7b…` (pr 7, 93/100) | `0x4a2a834416…` block 36366305 | [`0x1595853047fce8df0ea2c37565ce6ef37b5622d19880d985a3b5fa364f0fcbf9`](https://hyperevmscan.io/tx/0x1595853047fce8df0ea2c37565ce6ef37b5622d19880d985a3b5fa364f0fcbf9) | 0.0000355 HYPE |

`agents(0x5f2b…47f37).reviewCount` → **3** (live at /api/chain/hyperliquid, 2026-09-25).

## Why mainnet (decision record)

Every testnet faucet gates on anti-sybil proofs: Chainstack requires ≥0.08 ETH mainnet *sustained through an undocumented lookback* (`OLD_BALANCE_BELOW_THRESHOLD_ERROR` even for freshly-funded addresses), QuickNode requires a Hyperliquid L1 mainnet balance, thirdweb's faucet is paywalled, and the official drip gives mock USDC only. Meanwhile HyperEVM mainnet gas is 0.1 gwei: the entire Gate B + months of attestations ≈ 0.002 HYPE (~$0.19). Buying the gas outright beat the faucet war.

## Testnet runbook (historical — chain 998, never deployed)

The original plan deployed DIRECT to testnet (no v1 history), per SPEC-4 §2. Preserved verbatim below for the gotchas — they carry to mainnet.

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
