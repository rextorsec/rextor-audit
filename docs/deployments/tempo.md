# RextorAttestation — Tempo testnet (Moderato) deployment

**Deploy #1 (flagship track) — SPEC-4 §2.** Recorded 2026-09-17.

| Field | Value |
|---|---|
| Contract | [`RextorAttestation`](../../contracts/attestation-evm/src/RextorAttestation.sol) (immutable v1) |
| Address | `0x513707577e4d8925295072df7944b0659228d31f` |
| Chain | Tempo testnet (Moderato), chainId 42431 |
| RPC | `https://rpc.moderato.tempo.xyz` |
| Deploy tx | [`0x8a915336291a32b0287af03a1ab1a9567cca20a1e1efe7ac8def2c6fc0af31cd`](https://explore.testnet.tempo.xyz/tx/0x8a915336291a32b0287af03a1ab1a9567cca20a1e1efe7ac8def2c6fc0af31cd) |
| Block | 35,628,614 |
| Gas used | 5,772,099 (fixed 30M limit — gotcha 2) |
| Deployer / owner | `0xD61626B13484F2ae0342566894e8f87e51756B73` — RECTOR-controlled, `DEPLOY_PRIVATE_KEY` in the secret-store `.env` |
| Attest agent | `0xE6906A58ea17E28aFEFBA5bBcD5EBa85BF58a122` — `REXTOR_AGENT_PRIVATE_KEY`; registered as `rextor-audit[bot]`, active |
| registerAgent tx | [`0xa4fc1e84970ed173842e2e66fb718268257fd500c6bab778a6b9526d3f9806a6`](https://explore.testnet.tempo.xyz/tx/0xa4fc1e84970ed173842e2e66fb718268257fd500c6bab778a6b9526d3f9806a6) (block 35,628,781) |
| Contract commit | `86e5dd7` on main (contract source unchanged since `e03b2ae`) |
| Explorer | [address page](https://explore.testnet.tempo.xyz/address/0x513707577e4d8925295072df7944b0659228d31f) — source unverified, registry explorer slot stays null until verification |

Agent-service wiring (secret-store `.env`): `REXTOR_ATTEST_CONTRACT_ADDRESS`, `REXTOR_AGENT_PRIVATE_KEY`, `REXTOR_FORK_RPC_URL=https://rpc.moderato.tempo.xyz`.

## Smoke verification (2026-09-17)

- `agents(0xE6906A…)` → `("rextor-audit[bot]", true, 0)` — registered, active, zero reviews.
- `verify(bytes32(0), …)` → `false` — unknown reviewId rejects.
- `owner()` → `0xD61626B…` — deployer holds ownership (`registerAgent`/`setAgentActive` gated).

## Deploy #2 (v2) — 2026-09-18

Contract v2 (findingsURI + targetChainId) per SPEC-4 errata. **Supersedes deploy #1 as the registry slot; v1 record above is historical.** `reviewCount` reset by redeploy — documented per plan.

| Field | Value |
|---|---|
| Address | `0x7fe69adeaaaf5fb2344ab14ac0eec42463410bcd` |
| Deploy tx | [`0x1e38c1c50c4993dabe7ddee7ef4f4858d674205276a0723e44173627ee8771dc`](https://explore.testnet.tempo.xyz/tx/0x1e38c1c50c4993dabe7ddee7ef4f4858d674205276a0723e44173627ee8771dc) — block 35,797,315 |
| registerAgent tx | [`0xb837aee905fe07f811a7fe76cc279a36353931ae731a46caf54ad0fd7beb822b`](https://explore.testnet.tempo.xyz/tx/0xb837aee905fe07f811a7fe76cc279a36353931ae731a46caf54ad0fd7beb822b) — block 35,797,406 |
| Smoke attest tx | [`0x64569102970c3c841ce2d656438fbbb1373feb9305bc5aaeab41cd3275db9e20`](https://explore.testnet.tempo.xyz/tx/0x64569102970c3c841ce2d656438fbbb1373feb9305bc5aaeab41cd3275db9e20) — block 35,797,815 |
| Agent | `0xE690…a122` ("rextor-audit[bot]", active) — re-registered on v2 |
| Smoke verification | `verify(true-payload)=true`, `verify(tampered-34)=false` (from public artifacts via `cast call`); smoke record is synthetic (`reviewId` namespaced `smoke`, `findingsURI=ipfs://smoke-nonprod-placeholder` — JWT not yet provisioned) |
| `agents()` after smoke | `("rextor-audit[bot]", true, 1)` |
| Contract commit | feat/attestation-v2 (T5+T6+T7 work; Smoke.s.sol added with this record) |

Gotcha 5 (new): this vendored forge-std lacks `vm.assert` and `vm.log` on `Vm` — ops scripts use plain `require`/`revert` guards (see `Smoke.s.sol`).

## Gotchas (Tempo-specific, load-bearing for future deploys)

1. **`eth_estimateGas` ignores Tempo's state-creation premiums** (TIP-1000: 250k/new slot, 250k/account, 1k/byte). The CREATE estimated at 1,519,693 gas; actual need was 5,772,099. Both estimate-based attempts reverted out-of-gas (`0x5c3b31…`, `0xf3b13b…`), burning two nonces before the fixed-limit attempt landed at nonce 2.
2. **`forge script --gas-limit` is overridden by the simulation estimate.** The fixed limit only sticks with `--skip-simulation`:
   `FOUNDRY_PROFILE=tempo forge script script/Deploy.s.sol --broadcast --slow --skip-simulation --gas-limit 30000000`.
   `Register.s.sol` carries the same requirement in its doc comment.
3. **No native gas token.** Fees for plain EVM txs to non-TIP-20 contracts (deploys, `attest()`) default to pathUSD (`0x20C0000000000000000000000000000000000000`); the faucet is programmatic — `cast rpc tempo_fundAddress <lowercase-addr> --rpc-url https://rpc.moderato.tempo.xyz` drips 1M of each USD asset. Failed txs still pay fees (~$0.76 for the 1.5M-gas OOG).
4. **This foundry build reads no env var for wallet keys in `forge create`/`cast send`** (`PRIVATE_KEY`/`ETH_PRIVATE_KEY` both ignored) — and `--private-key` argv leaks through `ps`. Ops scripts therefore use `vm.envUint` (see `Deploy.s.sol`, `Register.s.sol`).
