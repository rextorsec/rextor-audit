# AttestationSolana — Solana devnet verdict program (B4)

**Status: LIVE on devnet (2026-09-19).** 🔴 gate cleared by RECTOR ("GO — deploy now"); deployed via direct `solana program deploy` (anchor 0.31.1's deploy wrapper mis-parses agave 3.x CLI output — bypass documented below).

| Field | Value |
|---|---|
| Program | [`AttestationSolana`](../../programs/attestation-solana/) — anchor-lang 0.31.1 (pinned) |
| ProgramId | [`Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs`](https://explorer.solana.com/address/Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs?cluster=devnet) |
| Keypair | `~/Documents/secret/rextor-audit/attestation-solana-devnet.json` (iCloud secret store, never committed) |
| Cluster | Solana devnet — `https://api.devnet.solana.com` |
| Fee payer / upgrade authority | shared devnet wallet `FGSkt8MwXH83daNNW8ZkoqhL1KLcLoZLcdGJz84BWWr` |
| Deploy tx | [`n5SVHDzZKfmrxTQoJvB4LUGu8yAevaYovuuxY5X6vfV8sa2Lx2g9zoA4mhPMUgjPmT2RxauBid7ocizTaCjoSMA`](https://explorer.solana.com/tx/n5SVHDzZKfmrxTQoJvB4LUGu8yAevaYovuuxY5X6vfV8sa2Lx2g9zoA4mhPMUgjPmT2RxauBid7ocizTaCjoSMA?cluster=devnet) — slot 500929335 |
| ProgramData | `72Ytr4U4cfT97z1fLTjwhZdNVXW8VrHoLnAFY3Vnm78Z` |
| Data length | 206,472 bytes · program balance 1.0498 SOL (min rent) |
| Smoke tx | [`5iognq3WL7uKdYGqHJvjv1kUUEPZAKqP3bnu5LC6psA2LQ4C8mKDV7JtKHM9ajAmNw7L84G121JFdkRUbhJ3QEkZ`](https://explorer.solana.com/tx/5iognq3WL7uKdYGqHJvjv1kUUEPZAKqP3bnu5LC6psA2LQ4C8mKDV7JtKHM9ajAmNw7L84G121JFdkRUbhJ3QEkZ?cluster=devnet) — slot 500929671 |
| Smoke PDA | `BqpVueaAJBW7s69yhMrzoWbmdg5jvLhSaPLRQW4Sswkb` = `["review", "smoke:rextor-b4-receipt"-namespaced id]` — riskScore 7, status 0, `findingsUri ipfs://smoke-nonprod-placeholder` (synthetic smoke namespace, same convention as the Tempo smoke) |
| Wallet after deploy | 4.1925 SOL remaining |

## Semantics (SPEC-8 §6)

- Instruction `attest_review(review_id: [u8;32], risk_score: u8, status: u8, findings_uri: String ≤128)`.
- One PDA per review: seeds `["review", review_id]`; fields `{agent, risk_score, status, findings_uri, slot}`.
- `agent` = transaction signer (the attesting agent identity).
- Idempotency mirrors the EVM contract (invariant 28): identical replay → no-op Ok; conflicting verdict or agent → `IdempotencyConflict`.
- `status` vocabulary: 0 = complete, 1 = incomplete (same as Tempo). `risk_score` ≤ 100 enforced.

## Steps as executed (2026-09-19)

1. Sanity: `solana balance --url devnet` — 5.244 SOL on the shared wallet.
2. Deploy — `anchor deploy` (0.31.1) FAILED twice with a phantom
   `AccountNotFound … error sending request`: its wrapper mis-parses agave 3.x
   CLI output. Bypassed with the CLI directly:
   ```sh
   solana program deploy target/deploy/attestation_solana.so --url devnet \
     --keypair ~/Documents/secret/rextor-audit/attestation-solana-devnet.json \
     --fee-payer ~/Documents/secret/solana-devnet.json \
     --upgrade-authority ~/Documents/secret/solana-devnet.json
   # → Program Id Aj6Nx…kMDs, tx n5SVHDzZ…TaCjoSMA
   ```
   (`anchor deploy` may work again once the CLI/agave output formats re-align;
   the direct path is deterministic and needs nothing from anchor.)
3. Smoke: `scripts/smoke.ts` via ts-mocha with `ANCHOR_PROVIDER_URL` +
   `ANCHOR_WALLET` env — tx 5iognq3W…J3QEkZ, PDA BqpVuea…4Sswkb read back with
   the exact fields. GOTCHA: the smoke `review_id` must be EXACTLY 32 bytes —
   a 30-byte buffer passed the TS layer silently and failed on-chain as
   `ConstraintSeeds` (client-derived PDA ≠ program-derived).
4. Receipt flips: `chains.ts` solana slot ← ProgramId (test literal updated,
   incl. the null-address exception list), `capabilities.json` onchain-verdict
   row ← two receipts (Tempo + Solana), HyperEVM chip only remaining, matrix
   row 5, this page.

## Notes

- anchor 0.30.1 required `[profile.release] overflow-checks = true` (added to the
  workspace Cargo.toml — SBF arithmetic must trap, never wrap).
- `init_if_needed` requires the `init-if-needed` feature; the documented
  re-initialization hazard is closed by construction here (program-derived PDA +
  conflict branch — see SPEC-8 §6 and the program Cargo.toml comment).
- Self-dogfood note: the rextor-audit repo itself now contains
  `programs/*/Cargo.toml` with `anchor-lang`, so PRs touching `programs/**` route
  through the B5 semgrep slice — the agent reviews its own adapter.
