//! Gate B fixture: deliberately vulnerable Anchor-style vault.
//! Static-analysis target only — NOT deployable, do NOT `anchor build`.
//!
//! Vulnerabilities (same spirit as the EVM fixture):
//!   (a) `withdraw` performs no authority/signer check — any caller drains the vault.
//!   (b) `set_owner` has no signer constraint — anyone can seize ownership.

use anchor_lang::prelude::*;

declare_id!("Vau1t11111111111111111111111111111111111111");

#[program]
pub mod solana_vault {
    use super::*;

    /// VULN (a): missing authority/signer check — any caller can drain.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.balance = vault.balance.checked_sub(amount).unwrap();
        **ctx
            .accounts
            .destination
            .to_account_info()
            .try_borrow_mut_lamports()? += amount;
        Ok(())
    }

    /// VULN (b): missing signer constraint — anyone can take over.
    pub fn set_owner(ctx: Context<SetOwner>, new_owner: Pubkey) -> Result<()> {
        ctx.accounts.vault.owner = new_owner;
        Ok(())
    }
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub balance: u64,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    /// BUG: `destination` is never validated as an owned ATA/treasury.
    #[account(mut)]
    pub destination: AccountInfo<'info>,
    // BUG: no `authority: Signer<'info>` — nobody proves the caller
    // is `vault.owner` before lamports move.
}

#[derive(Accounts)]
pub struct SetOwner<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    // BUG: no authority account, no `#[account(constraint = ...)]`,
    // no `Signer` — `set_owner` never authenticates the caller.
}
