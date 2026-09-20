# RextorAttestation — Tempo testnet (Moderato) deployment

**Deploy #3 (flagship track) — SPEC-4 §2.** Recorded 2026-09-20. **This is the LIVE deployment** — see "Redeploys" for why #1 and #2 are dead.

| Field | Value |
|---|---|
| Contract | [`RextorAttestation`](../../contracts/attestation-evm/src/RextorAttestation.sol) (immutable **v2**: `findingsURI` + `targetChainId`) |
| Address | `0x51ac8214089daf85b188437b087519acfc6c495a` |
| Chain | Tempo testnet (Moderato), chainId 42431 |
| RPC | `https://rpc.moderato.tempo.xyz` |
| Deploy tx | `0x82e39e5595aa6dec1a44c1b4e0d45e74c4cc45a98657a32cde43841dd4dc6` |
| Deployer / owner | `0x273ae839a5447CEE34b9a694Bb62C9e61086d76d` (post-rotation owner key — `DEPLOY_PRIVATE_KEY` in the secret-store `.env`) |
| Attest agent | `0x5f2b9C1549F7e178dC0cC15FdCf3719c9fb47f37` — registered as `rextor-audit`, **active** (`REXTOR_AGENT_PRIVATE_KEY`) |
| Contract commit | `e0db923`+ (F5 flip) |

## Smoke verification (2026-09-20)

- test-repo PR #6 head `5bf977f`: attest tx `0xe26fd7cf834efd49be6445bb4ff1c895630b423d75b25285ad31220dfd314fda` — attested footer rendered in the PR comment with IPFS `findingsURI` (pin live).
- **Check-run `rextor-audit` authored by the App** (`app.slug: rextor-audit`, conclusion neutral — the smoke diff's analyzer run was INCOMPLETE, a separate analyzer-health issue): https://github.com/rextorsec/rextor-audit-test/runs/106055809189 — F5 receipt: the merge-gate check-run posts via the GitHub App installation token (`checks: write`), not the PAT.

## Redeploys

- **#1** `0x513707577e4d8925295072df7944b0659228d31f` (v1, 2026-09-17) — superseded by the v2 redeploy (#2).
- **#2** `0x7fe69adeaaaf5fb2344ab14ac0eec42463410bcd` (v2, 2026-09-18) — **dead 2026-09-20**: the Tempo testnet state reset wiped agent registrations, and `owner()` remained the retired pre-rotation deployer key (`0xD61626B1…73`, key since destroyed) — re-registration impossible. PR #5's attested footers cite #2; historical, immutable, point-in-time.
- **#3** `0x51ac8214089daf85b188437b087519acfc6c495a` (v2, 2026-09-20) — current. Owner = post-rotation key; full receipt chain live.

## Historical records

**#1 (v1)** — deploy tx [`0x8a915336…0af31cd`](https://explore.testnet.tempo.xyz/tx/0x8a915336291a32b0287af03a1ab1a9567cca20a1e1efe7ac8def2c6fc0af31cd) (block 35,628,614, gas 5,772,099 of fixed 30M); registerAgent tx [`0xa4fc1e84…9806a6`](https://explore.testnet.tempo.xyz/tx/0xa4fc1e84970ed173842e2e66fb718268257fd500c6bab778a6b9526d3f9806a6); agent `0xE690…a122` ("rextor-audit[bot]", active); commit `86e5dd7`. Smoke: `agents → ("rextor-audit[bot]", true, 0)`, `verify(unknown reviewId) → false`, `owner → 0xD61626B…`.

**#2 (v2)** — deploy tx [`0x1e38c1c5…e8771dc`](https://explore.testnet.tempo.xyz/tx/0x1e38c1c50c4993dabe7ddee7ef4f4858d674205276a0723e44173627ee8771dc) (block 35,797,315); registerAgent tx [`0xb837aee9…beb822b`](https://explore.testnet.tempo.xyz/tx/0xb837aee905fe07f811a7fe76cc279a36353931ae731a46caf54ad0fd7beb822b); smoke attest tx [`0x64569102…5db9e20`](https://explore.testnet.tempo.xyz/tx/0x64569102970c3c841ce2d656438fbbb1373feb9305bc5aaeab41cd3275db9e20) (synthetic record — JWT not yet provisioned then); agent `0xE690…a122` re-registered; `verify(true-payload)=true`, `verify(tampered)=false`; `reviewCount` reset documented. Vendored forge-std of that era lacked `vm.assert`/`vm.log` — ops guards used plain `require`/`revert`.

## Agent-service wiring (secret-store `.env`)

`REXTOR_ATTEST_CONTRACT_ADDRESS` (→ #3), `REXTOR_AGENT_PRIVATE_KEY`, `REXTOR_FORK_RPC_URL=https://rpc.moderato.tempo.xyz`.

## Gotchas (Tempo-specific, load-bearing for future deploys)

1. **`eth_estimateGas` ignores Tempo's state-creation premiums** (TIP-1000: 250k/new slot, 250k/account, 1k/byte). The CREATE estimated at 1,519,693 gas; actual need was 5,772,099. Estimate-based attempts revert out-of-gas on-chain — use the fixed limit (gotcha 2). *2026-09-20: still true after the state reset — the funded estimate (1.81M) produced an on-chain `Transaction Failure` for the CREATE.*
2. **`forge script --gas-limit` is overridden by the simulation estimate.** The fixed limit only sticks with `--skip-simulation`:
   `FOUNDRY_PROFILE=tempo forge script script/Deploy.s.sol --broadcast --slow --skip-simulation --gas-limit 30000000`.
   `Register.s.sol` carries the same requirement in its doc comment.
   **2026-09-20 addendum:** with `--skip-simulation` and a ZERO-BALANCE sender, the tx builder fails with `missing keys: ["gas_limit"]` — that error was the zero-balance estimator error in disguise, NOT a forge regression. Fund the sender first (gotcha 3) and the runbook command works as written.
3. **No native gas token.** Fees for plain EVM txs to non-TIP-20 contracts (deploys, `attest()`) default to pathUSD (`0x20C0000000000000000000000000000000000000`); the faucet is programmatic — `cast rpc tempo_fundAddress <lowercase-addr> --rpc-url https://rpc.moderato.tempo.xyz` drips 1M of each USD asset. Failed txs still pay fees (~$0.76 for the 1.5M-gas OOG).
   **2026-09-20 addendum:** the testnet state reset zeroed EVERYONE — fund **both** the deployer/owner key AND the attesting agent key (attest()'s sender needs its own pathUSD; `attest` from a broke agent fails `insufficient funds … have 0 want 214054`).
4. **This foundry build reads no env var for wallet keys in `forge create`/`cast send`** (`PRIVATE_KEY`/`ETH_PRIVATE_KEY` both ignored) — and `--private-key` argv leaks through `ps`. Ops scripts therefore use `vm.envUint` (see `Deploy.s.sol`, `Register.s.sol`).
5. **Testnet state resets are real.** A reset between 2026-09-20 08:06 and 16:16 local wiped contract state (agent registrations) while leaving deployed bytecode + ownership in place — a live contract can silently become unusable (`NotActiveAgent()` revert, selector `0x3ecd463a`). Probe `agents(agent)` before blaming the client.
6. **The vendored forge-std predates some cheatcodes** (`vm.txGasLimit` undeclared; historically `vm.assert`/`vm.log` too). Calling the cheatcode precompile directly from a script does NOT work — foundry only intercepts declared-interface calls, so the deploy reverts with "call to non-contract address 0x7109709…". Use the funded-sender + fixed-limit path (gotchas 2–3) instead of fighting the interface.
