# AttestationSolana — Solana devnet verdict program (B4)

**Status: PRE-GATE (2026-09-19).** Program built + localnet-tested per SPEC-8 §6.
**🔴 Devnet deploy is a RECTOR gate (week-4 plan, global constraints) — this page records the deployment once RECTOR's go lands.**

| Field | Value |
|---|---|
| Program | [`AttestationSolana`](../../programs/attestation-solana/) — anchor-lang 0.30.1 (pinned to the installed CLI) |
| ProgramId | `Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs` |
| Keypair | `~/Documents/secret/rextor-audit/attestation-solana-devnet.json` (iCloud secret store, never committed) |
| Cluster | Solana devnet — `https://api.devnet.solana.com` (verified live 2026-09-19, getHealth → ok) |
| Fee payer / upgrade authority | shared devnet wallet `FGSkt8MwXH83daNNW8ZkoqhL1KLcLoZLcdGJz84BWWr` (`~/Documents/secret/solana-devnet.json`, ~5 SOL at pre-gate) |
| Deploy tx | — |
| Slot | — |
| Explorer | — |

## Semantics (SPEC-8 §6)

- Instruction `attest_review(review_id: [u8;32], risk_score: u8, status: u8, findings_uri: String ≤128)`.
- One PDA per review: seeds `["review", review_id]`; fields `{agent, risk_score, status, findings_uri, slot}`.
- `agent` = transaction signer (the attesting agent identity).
- Idempotency mirrors the EVM contract (invariant 28): identical replay → no-op Ok; conflicting verdict or agent → `IdempotencyConflict`.
- `status` vocabulary: 0 = complete, 1 = incomplete (same as Tempo). `risk_score` ≤ 100 enforced.

## Steps (after RECTOR's go)

1. Sanity: `solana balance --url devnet` on the shared wallet (≥ ~0.5 SOL for deploy + rent; a program's min rent ≈ 0.22 SOL at 174+8 bytes of data... program size dominates: expect ≈ 3–5 SOL total — check `ls -l target/deploy/attestation_solana.so` and fund accordingly).
2. From `programs/attestation-solana/`:
   ```sh
   anchor deploy --provider.cluster devnet \
     --provider.wallet ~/Documents/secret/solana-devnet.json
   ```
   (The provider wallet in Anchor.toml stays localnet; the CLI override wins.)
3. Smoke (ops, deterministic — mirrors the Tempo Smoke.s.sol receipt):
   `ts-node`-style one-off via ts-mocha-free script or `anchor run` — post one
   `attestReview` with a namespaced `review_id` (prefix `smoke:`-equivalent bytes),
   verify `program.account.review.fetch` returns the fields, and record the tx.
4. Record ProgramId + tx + slot in the table above; flip `chains.ts`
   `solana.attestation.address` to the ProgramId literal + update
   `chains.test.ts` (mirror the Tempo `5019723` pattern); flip the
   `solana-program` capabilities/matrix row with the receipt.

## Notes

- anchor 0.30.1 required `[profile.release] overflow-checks = true` (added to the
  workspace Cargo.toml — SBF arithmetic must trap, never wrap).
- `init_if_needed` requires the `init-if-needed` feature; the documented
  re-initialization hazard is closed by construction here (program-derived PDA +
  conflict branch — see SPEC-8 §6 and the program Cargo.toml comment).
- Self-dogfood note: the rextor-audit repo itself now contains
  `programs/*/Cargo.toml` with `anchor-lang`, so PRs touching `programs/**` route
  through the B5 semgrep slice — the agent reviews its own adapter.
