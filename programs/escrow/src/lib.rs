use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("GR9ho64CPNcvYFFMxd8F3GxgjApBmJc2xR78NRyCYRZ8");

#[program]
pub mod escrow {
    use super::*;

    pub fn create_offer(
        ctx: Context<CreateOffer>,
        send_amt: u64,
        ask_amt: u64,
        party_two: Pubkey,
    ) -> Result<()> {
        require!(send_amt > 0, EscrowError::ZeroSendAmount);
        require!(ask_amt > 0, EscrowError::ZeroAskAmount);
        require_keys_neq!(
            ctx.accounts.party_one.key(),
            party_two,
            EscrowError::InvalidPartyTwo
        );
        let cpi_accounts = Transfer {
            from: ctx.accounts.send_account.to_account_info(),
            to: ctx.accounts.temp_account.to_account_info(),
            authority: ctx.accounts.party_one.to_account_info(),
        };
        let cpi_context =
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_context, send_amt)?;
        ctx.accounts.offer_details.set_inner(OfferDetails {
            party_one: ctx.accounts.party_one.key(),
            party_two: party_two,
            receive_account: ctx.accounts.receive_account.key(),
            offer_token: ctx.accounts.send_mint.key(),
            offer_amount: send_amt,
            ask_token: ctx.accounts.receive_mint.key(),
            ask_amount: ask_amt,
        });
        Ok(())
    }

    pub fn close_offer(ctx: Context<CloseOffer>, _party_two: Pubkey) -> Result<()> {
        let cpi_accounts = Transfer {
            from: ctx.accounts.temp_account.to_account_info(),
            to: ctx.accounts.receive_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_context = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_context.with_signer(&[&["authority".as_bytes().as_ref(), &[*ctx.bumps.get("authority").unwrap()]]]), ctx.accounts.offer_details.offer_amount)?;

        Ok(())
    }

    pub fn accept_offer(ctx: Context<AcceptOffer>) -> Result<()> {
        let offer_details = &ctx.accounts.offer_details;
        let mut cpi_accounts = Transfer {
            from: ctx.accounts.party_two_send.to_account_info(),
            to: ctx.accounts.party_one_receive.to_account_info(),
            authority: ctx.accounts.party_two.to_account_info(),
        };
        let mut cpi_context =
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_context, offer_details.ask_amount)?;
        cpi_accounts = Transfer {
            from: ctx.accounts.temp_account.to_account_info(),
            to: ctx.accounts.party_two_receive.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        cpi_context = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(
            cpi_context.with_signer(&[&[
                "authority".as_bytes().as_ref(),
                &[*ctx.bumps.get("authority").unwrap()],
            ]]),
            offer_details.offer_amount,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(send_amt: u64, ask_amt: u64, party_two: Pubkey)]
pub struct CreateOffer<'info> {
    #[account(mut)]
    pub party_one: Signer<'info>,
    pub send_mint: Account<'info, Mint>,
    #[account(mut,
              token::authority = party_one,
              token::mint = send_mint,
              constraint= send_account.amount>=send_amt @ EscrowError::InsufficientBalance)]
    pub send_account: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = party_one,
              associated_token::authority = authority,
              associated_token::mint = send_mint)]
    pub temp_account: Account<'info, TokenAccount>,
    /// CHECK: pda to act as authority of temp_account
    #[account(seeds=["authority".as_bytes().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,
    pub receive_mint: Box<Account<'info, Mint>>,
    #[account(token::authority = party_one,
              token::mint = receive_mint)]
    pub receive_account: Box<Account<'info, TokenAccount>>,
    #[account(init, payer=party_one, space=8+32+32+32+32+8+32+8,
              seeds=["escrow".as_bytes().as_ref(), party_one.key().as_ref(), party_two.as_ref()],
              bump)]
    pub offer_details: Account<'info, OfferDetails>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(party_two: Pubkey)]
pub struct CloseOffer<'info> {
    #[account(mut)]
    pub party_one: Signer<'info>,
    #[account(mut, close=party_one,
              seeds=["escrow".as_bytes().as_ref(), party_one.key().as_ref(), party_two.as_ref()],
              bump)]
    pub offer_details: Account<'info, OfferDetails>,
    /// CHECK: pda to act as authority of temp_account
    #[account(seeds=["authority".as_bytes().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(address = offer_details.offer_token)]
    pub send_mint: Account<'info, Mint>,
    #[account(mut, 
              associated_token::authority = authority,
              associated_token::mint = send_mint)]
    pub temp_account: Account<'info, TokenAccount>,
    #[account(mut, 
              token::authority = party_one,
              token::mint = send_mint)]
    pub receive_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    /// CHECK: offer_details account would already have been created using its address
    #[account(mut)]
    pub party_one: UncheckedAccount<'info>,
    pub party_two: Signer<'info>,
    #[account(mut, close=party_one,
              seeds=["escrow".as_bytes().as_ref(), party_one.key().as_ref(), party_two.key().as_ref()],
              bump)]
    pub offer_details: Box<Account<'info, OfferDetails>>,
    /// CHECK: pda to act as authority of temp_account
    #[account(seeds=["authority".as_bytes().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(address = offer_details.offer_token @ EscrowError::InvalidMintAccount)]
    pub party_one_mint: Box<Account<'info, Mint>>,
    #[account(address = offer_details.ask_token @ EscrowError::InvalidMintAccount)]
    pub party_two_mint: Box<Account<'info, Mint>>,
    #[account(mut,
              associated_token::authority=authority,
              associated_token::mint = party_one_mint)]
    pub temp_account: Account<'info, TokenAccount>,
    #[account(mut,
              address = offer_details.receive_account @ EscrowError::IncorrectReceiveAccount,
              token::authority = party_one,
              token::mint = party_two_mint)]
    pub party_one_receive: Account<'info, TokenAccount>,
    #[account(mut,
              token::authority = party_two,
              token::mint = party_two_mint,
              constraint = party_two_send.amount>=offer_details.ask_amount @ EscrowError::InsufficientBalance)]
    pub party_two_send: Account<'info, TokenAccount>,
    #[account(mut,
              token::authority = party_two,
              token::mint = party_one_mint)]
    pub party_two_receive: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct OfferDetails {
    pub party_one: Pubkey,
    pub party_two: Pubkey,
    pub receive_account: Pubkey, // token account address of party one
    pub offer_token: Pubkey,     // mint address of token sent by party one
    pub offer_amount: u64,
    pub ask_token: Pubkey, // mint address of token to be sent by party two
    pub ask_amount: u64,
}

#[error_code]
pub enum EscrowError {
    #[msg("Token account does not have enough token balance to send")]
    InsufficientBalance,
    #[msg("Send amount for party one can not be zero")]
    ZeroSendAmount,
    #[msg("Send amount for party two can not be zero")]
    ZeroAskAmount,
    #[msg("Both parties must be different")]
    InvalidPartyTwo,
    #[msg("Mint account passed for either (or both) of the tokens is incorrect")]
    InvalidMintAccount,
    #[msg("Receive account for party one is incorrect")]
    IncorrectReceiveAccount,
}
