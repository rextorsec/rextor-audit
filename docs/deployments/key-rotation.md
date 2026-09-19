# Key rotation runbook — session-log exposure 2026-09-20

**Status: DRAFTED, not executed.** RECTOR ruled "rotate after C2" (2026-09-20);
C2 broadcasts are complete, so rotation is now actionable.

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
   b. `transferFrom`/safeTransferOrMint: move agentId 50891 to the new owner
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
