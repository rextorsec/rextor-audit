# Key rotation runbook — session-log exposure 2026-09-20

**Status: EXECUTED 2026-09-20 (same day).** 🔴 gates cleared by RECTOR
("Full auto with 🔴 pauses"); scripted keygen into the iCloud secret store.
Exposed keys are retired — both old EOAs hold dust only.

## Executed record (2026-09-20)

| Step | Tx | Result |
|---|---|---|
| Service token | off-chain | new 64-hex in secret `.env` + Vercel prod swap + redeploy + re-alias; old token verified 401 |
| Agent sweep | [`0x2c1e10e9…378bffbc`](https://etherscan.io/tx/0x2c1e10e9711399ab448f6040dc7f6b1cddfe383ddb4b9b69aadec6ab378bffbc) | 0.00018 ETH → new agent `0x5f2b…47f37` |
| NFT transfer | [`0x27852907…3cd41307`](https://etherscan.io/tx/0x2785290761355382e5b17451cb247001a1020e2e922eed59b0fb419f3cd41307) | `ownerOf(50891)` = new owner; `agentWallet` metadata auto-cleared (2.0.0 `_update`) |
| Owner sweep | [`0xecd77664…f3f35b73`](https://etherscan.io/tx/0xecd776646764a763bd0525f6baf6800aa8f981374f1027ea1d371189f3f35b73) | 0.0014 ETH → new owner `0x273a…8d76d` |
| agentWallet re-bind | [`0xfb54a416…b6bdfe`](https://etherscan.io/tx/0xfb54a416aca3d368e780bf1f6645db29946713d7668da49757ba58f7a0b6bdfe) | `getAgentWallet(50891)` = `0x5f2b…47f37` (owner = new owner broadcasts, new agent signs — both NEW keys exercised on-chain) |

## New identities (post-rotation)

| Role | Address | Key file (secret store) |
|---|---|---|
| Owner / broadcaster | `0x273ae839a5447CEE34b9a694Bb62C9e61086d76d` | `owner-eoa-2026-09-20.json` → `DEPLOY_PRIVATE_KEY` |
| Agent wallet / Tempo attester | `0x5f2b9C1549F7e178dC0cC15FdCf3719c9fb47f37` | `agent-eoa-2026-09-20.json` → `REXTOR_AGENT_PRIVATE_KEY` |

Historical note: the seeded reputation feedback (95/100) and the C1/C2 txs
remain attributed to the RETIRED addresses `0xE690…a122` / `0xD616…73` —
immutable ledger rows; `docs/deployments/erc8004.md` keeps them as history.
Solana side untouched: `REXTOR_SOLANA_KEYPAIR` (shared devnet wallet) was NOT
part of the exposure.

**Pinata JWT roll — EXECUTED 2026-09-20.** New scoped key `rextor-audit-2026`
(dd687beb…, pinFileToIPFS-write only) verified via `data/testAuthentication`
and swapped into the secret `.env`; old broad-scope key `rextor-audit`
(e2822675…) revoked — the leaked JWT is dead. Pinned CIDs unaffected.

## What was exposed, where, and scope

During the 2026-09-20 session a careless `tail .env` printed live secret
VALUES into the session transcript (log lives locally on RECTOR's Mac;
nothing committed; no third-party system involved — the transcript is the omp
session log under `~/.omp`):

| Secret | Role | Exposure risk |
|---|---|---|
| `REXTOR_AGENT_PRIVATE_KEY` | agent EOA `0xE690…a122` — Tempo attester, ERC-8004 agentWallet, feedback client | identity + any funds ever placed there; currently 0.00018 ETH |
| `DEPLOY_PRIVATE_KEY` | owner/broadcaster `0xD616…73` — owns agentId 50891 | **holds mainnet ETH**; controls the ERC-8004 NFT |
| `REXTOR_AGENT_TOKEN` | agent service API token (GET /reviews auth) | dashboard data read if someone reaches the tunnel |
| `IPFS_PINNING_JWT` | Pinata scoped key | pinning abuse (billable) |

Rotation is cheap NOW because every system that consumes these keys was
touched in this same session.

## Steps (in order; each step is a commit-free ops action unless noted)

1. **Agent service token** (`REXTOR_AGENT_TOKEN`, 5 min):
   new 64-hex token → `~/Documents/secret/rextor-audit/.env` +
   `vercel env rm/add REXTOR_AGENT_TOKEN production` → redeploy web → re-alias
   rextoraudit.com + www → `hub restart rextor-agent` (14-key wrapper).
2. **Pinata JWT** (10 min): roll the scoped key in the Pinata dashboard (old
   key dies at expiry/rotate), replace in `.env`; pinned CIDs survive key
   rotation.
3. **Agent EOA** `0xE690…a122` (15 min):
   a. new EOA keypair → becomes `REXTOR_AGENT_PRIVATE_KEY`;
   b. sweep funds from `0xE690…a122`;
   c. re-point the identity: `setAgentWallet(50891, <newEoa>, …)` via
      `script/SetAgentWallet8004.s.sol` (owner broadcasts, NEW wallet signs —
      the script already enforces the roles);
   d. future feedback goes from the new wallet; the seeded 95/100 feedback
      stays attributed to `0xE690…a122` forever (immutable ledger row — the
      erc8004.md record keeps the historical address, that is fine and
      expected).
   e. Tempo side: the Tempo attestation contract has no agent registry (SPEC-4
      attest uses the raw key as signer) — a new key attests identically; no
      on-chain change needed.
4. **Owner/broadcaster EOA** `0xD616…73` (30 min, most care):
   a. new owner EOA;
   b. `transferFrom` (or `safeTransferFrom` for untrusted recipients): move agentId 50891 to the new owner
      (owner-only op — do this BEFORE retiring the old key);
      NOTE: `_update` (IdentityRegistry 2.0.0) CLEARS `agentWallet` metadata on
      transfer — re-run step 3c afterwards;
   c. sweep ETH from `0xD616…73` to the new owner;
   d. update `DEPLOY_PRIVATE_KEY` in `.env`;
   e. HyperEVM broadcaster (same address family) follows automatically once the
      new key is in `.env`.
5. **Verification sweep**: `cast call` ownerOf/getAgentWallet/tokenURI;
   tunnel 401 probe; one dashboard fetch with the new token; one manual review
   trigger (full-loop smoke — currently pending the GitHub App webhook update,
   see handoff).

## Discipline fix (root cause)

Secret files are read with `cut -d= -f1` (KEY NAMES ONLY) or per-key
`grep '^KEY=' .env | cut -d= -f2` piped straight into the consuming command —
NEVER `cat`/`tail` the whole file. This rule already existed; the 2026-09-20
leak violated it. Reinforced in agent memory so the next session inherits the
correction.
