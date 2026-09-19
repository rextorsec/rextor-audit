//! SPEC-8 §6 — Solana verdict program (B4): the chain-native twin of the EVM
//! RextorAttestation contract, scoped to the adapter tier. One PDA per review
//! (seeds ["review", review_id]); the agent signs; idempotency semantics
//! mirror the EVM contract exactly (invariant 28): replaying the same verdict
//! is a no-op Ok, conflicting verdicts (including a different agent claiming
//! the review) are loud errors.
//!
//! review_id: [u8; 32] — the bytes of the SAME reviewId derivation the EVM
//! contract hashes; no derivation change lives on-chain.

use anchor_lang::prelude::*;

declare_id!("Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs");

#[program]
pub mod attestation_solana {
    use super::*;

    pub fn attest_review(
        ctx: Context<AttestReview>,
        review_id: [u8; 32],
        risk_score: u8,
        status: u8,
        findings_uri: String,
    ) -> Result<()> {
        require!(risk_score <= 100, AttestError::RiskScoreOutOfRange);
        // 0 = complete, 1 = incomplete — the same vocabulary as Tempo.
        require!(status <= 1, AttestError::StatusOutOfRange);
        require!(findings_uri.len() <= 128, AttestError::UriTooLong);

        let review = &mut ctx.accounts.review;
        if review.agent != Pubkey::default() {
            // Existing attestation: identical verdict → no-op Ok; anything
            // else (including a different agent) → loud conflict.
            require!(
                review.agent == ctx.accounts.agent.key()
                    && review.risk_score == risk_score
                    && review.status == status
                    && review.findings_uri == findings_uri,
                AttestError::IdempotencyConflict
            );
            return Ok(());
        }
        review.agent = ctx.accounts.agent.key();
        review.risk_score = risk_score;
        review.status = status;
        review.findings_uri = findings_uri;
        review.slot = Clock::get()?.slot;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(review_id: [u8; 32])]
pub struct AttestReview<'info> {
    #[account(
        init_if_needed,
        payer = agent,
        space = 8 + Review::LEN,
        seeds = [b"review", review_id.as_ref()],
        bump
    )]
    pub review: Account<'info, Review>,
    /// The attesting agent — must sign (the EVM contract's registered-agent
    /// identity, carried by the transaction signer here).
    #[account(mut)]
    pub agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Review {
    pub agent: Pubkey,        // 32
    pub risk_score: u8,       // 1
    pub status: u8,           // 1
    pub findings_uri: String, // 4 + ≤128
    pub slot: u64,            // 8
}

impl Review {
    pub const LEN: usize = 32 + 1 + 1 + (4 + 128) + 8;
}

#[error_code]
pub enum AttestError {
    #[msg("risk_score must be <= 100")]
    RiskScoreOutOfRange,
    #[msg("status must be 0 (complete) or 1 (incomplete)")]
    StatusOutOfRange,
    #[msg("findings_uri exceeds 128 bytes")]
    UriTooLong,
    #[msg("review already attested with a different verdict or agent")]
    IdempotencyConflict,
}
