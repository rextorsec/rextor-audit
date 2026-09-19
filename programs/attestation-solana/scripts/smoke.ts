// SPEC-8 §6 — post-deploy smoke (ops, 🔴 gated): post one attestation with a
// smoke-namespaced review_id on the DEPLOYED cluster, read it back, and print
// the receipt fields. Run after `anchor deploy`:
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
//   ANCHOR_WALLET=~/Documents/secret/solana-devnet.json \
//   pnpm exec ts-mocha -p ./tsconfig.json scripts/smoke.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AttestationSolana } from "../target/types/attestation_solana";
import { expect } from "chai";

describe("smoke: devnet attestation receipt", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.AttestationSolana as Program<AttestationSolana>;

  // "smoke"-namespaced: first byte 0x00 + "smoke:" marker — never collides
  // with a real review's id (same convention as the Tempo smoke namespace).
  const reviewId = Buffer.concat([
    Buffer.alloc(1, 0),
    Buffer.from("smoke:rextor-b4-receipt"),
    Buffer.alloc(6, 0),
  ]).subarray(0, 32);
  const [reviewPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("review"), reviewId],
    program.programId,
  );

  it("attests + reads back the smoke review", async () => {
    const tx = await program.methods
      .attestReview(Array.from(reviewId) as unknown as [number], 7, 0, "ipfs://smoke-nonprod-placeholder")
      .rpc();
    const review = await program.account.review.fetch(reviewPda);
    expect(review.riskScore).to.equal(7);
    expect(review.status).to.equal(0);
    expect(review.findingsUri).to.equal("ipfs://smoke-nonprod-placeholder");
    console.log("SMOKE RECEIPT");
    console.log("tx:", tx);
    console.log("programId:", program.programId.toBase58());
    console.log("reviewPda:", reviewPda.toBase58());
    console.log("slot:", review.slot.toString());
  });
});
