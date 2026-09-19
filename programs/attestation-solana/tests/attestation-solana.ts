// SPEC-8 §6 — verdict program acceptance: PDA creation + full fields,
// identical-replay no-op, loud conflict, and the three range guards. Runs on
// a throwaway localnet via `anchor test`.
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AttestationSolana } from "../target/types/attestation_solana";
import { expect } from "chai";

describe("attestation-solana (SPEC-8 §6)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.AttestationSolana as Program<AttestationSolana>;
  const agent = anchor.AnchorProvider.env().wallet;

  // Arbitrary but stable 32 bytes — the same recipe space the EVM contract
  // hashes (keccak of the review identity); contents are opaque on-chain.
  const reviewId = Buffer.alloc(32, 0xab);
  const [reviewPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("review"), reviewId],
    program.programId,
  );

  it("attests a review: PDA created with agent, score, status, uri, slot", async () => {
    await program.methods
      .attestReview(reviewId, 42, 0, "ipfs://QmTestReport")
      .rpc();
    const review = await program.account.review.fetch(reviewPda);
    expect(review.agent.equals(agent.publicKey)).to.be.true;
    expect(review.riskScore).to.equal(42);
    expect(review.status).to.equal(0);
    expect(review.findingsUri).to.equal("ipfs://QmTestReport");
    expect(Number(review.slot)).to.be.greaterThan(0);
  });

  it("identical replay is a no-op Ok (invariant 28)", async () => {
    await program.methods
      .attestReview(reviewId, 42, 0, "ipfs://QmTestReport")
      .rpc();
    const review = await program.account.review.fetch(reviewPda);
    expect(review.riskScore).to.equal(42);
    expect(review.findingsUri).to.equal("ipfs://QmTestReport");
  });

  it("conflicting verdict on the same review → IdempotencyConflict", async () => {
    try {
      await program.methods.attestReview(reviewId, 43, 0, "ipfs://QmTestReport").rpc();
      expect.fail("conflicting re-attest must throw");
    } catch (err) {
      expect((err as anchor.AnchorError).error.errorCode.code).to.equal("IdempotencyConflict");
    }
  });

  it("risk_score > 100 → RiskScoreOutOfRange", async () => {
    try {
      await program.methods.attestReview(reviewId, 101, 0, "ipfs://x").rpc();
      expect.fail("risk_score 101 must throw");
    } catch (err) {
      expect((err as anchor.AnchorError).error.errorCode.code).to.equal("RiskScoreOutOfRange");
    }
  });

  it("status > 1 → StatusOutOfRange", async () => {
    try {
      await program.methods.attestReview(reviewId, 42, 2, "ipfs://x").rpc();
      expect.fail("status 2 must throw");
    } catch (err) {
      expect((err as anchor.AnchorError).error.errorCode.code).to.equal("StatusOutOfRange");
    }
  });

  it("findings_uri over 128 bytes → UriTooLong", async () => {
    const longUri = `ipfs://${"a".repeat(122)}`; // 7 + 122 = 129 — one over the cap
    try {
      await program.methods.attestReview(reviewId, 42, 0, longUri).rpc();
      expect.fail("129-byte uri must throw");
    } catch (err) {
      expect((err as anchor.AnchorError).error.errorCode.code).to.equal("UriTooLong");
    }
  });
});
