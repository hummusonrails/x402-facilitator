-- X402 Facilitator Payment Tracking Schema
-- Migration 001: Initial schema

-- Main payments table with state machine
create table if not exists payments (
  nonce text primary key,
  user_address bytea not null,
  merchant_address bytea not null,
  token_address bytea not null,
  network text not null,
  total_amount numeric(78,0) not null,        -- bigint in base units (supports up to 2^256)
  incoming_tx_hash bytea,                      -- null until step 1 confirmed
  outgoing_tx_hash bytea,                      -- null until step 2 confirmed
  status text not null check (status in (
    'pending',             -- accepted at verify, not yet on chain
    'incoming_submitted',  -- tx1 hash stored
    'incoming_complete',   -- tx1 confirmed
    'outgoing_submitted',  -- tx2 hash stored
    'complete',            -- tx2 confirmed
    'failed'               -- terminal failure
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common queries
create index if not exists payments_status_idx on payments(status);
create index if not exists payments_merchant_idx on payments(merchant_address);
create index if not exists payments_created_idx on payments(created_at);
create index if not exists payments_user_idx on payments(user_address);

-- Trigger to automatically update updated_at timestamp
create or replace function bump_updated_at() returns trigger as $$
begin 
  new.updated_at = now(); 
  return new; 
end 
$$ language plpgsql;

drop trigger if exists trg_bump_updated_at on payments;
create trigger trg_bump_updated_at before update on payments
  for each row execute procedure bump_updated_at();

-- Optional: Payment events table for immutable audit trail
create table if not exists payment_events (
  id bigserial primary key,
  nonce text not null references payments(nonce),
  event_type text not null,
  event_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_events_nonce_idx on payment_events(nonce);
create index if not exists payment_events_created_idx on payment_events(created_at);

-- Comments for documentation
comment on table payments is 'Tracks x402 payment settlements with two-step flow';
comment on column payments.nonce is 'EIP-3009 nonce (unique per authorization)';
comment on column payments.status is 'State machine: pending → incoming_submitted → incoming_complete → outgoing_submitted → complete';
comment on column payments.total_amount is 'Total amount in token base units (merchant amount + fees)';
comment on column payments.incoming_tx_hash is 'Transaction hash for user → facilitator transfer';
comment on column payments.outgoing_tx_hash is 'Transaction hash for facilitator → merchant transfer';
