-- X402 Facilitator
-- Migration 008: Idempotency keys for POST /settle
--
-- A key is scoped to the merchant that sent it. It binds one logical charge (the fingerprint
-- of payer, amount, asset, payTo, network and resource) to the payment that settles it, so a
-- retry carrying a freshly signed authorization (new EIP-3009 nonce) for the same charge
-- resolves to the first payment instead of settling a second one.
-- Idempotent: safe to run with `pnpm migrate migrations/008_settle_idempotency.sql`.

create table if not exists settle_idempotency (
  merchant_address bytea not null,
  idempotency_key text not null,
  fingerprint text not null,
  nonce text not null references payments(nonce),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_address, idempotency_key)
);

create index if not exists settle_idempotency_nonce_idx on settle_idempotency(nonce);

drop trigger if exists trg_bump_updated_at on settle_idempotency;
create trigger trg_bump_updated_at before update on settle_idempotency
  for each row execute procedure bump_updated_at();

comment on table settle_idempotency is 'Idempotency-Key bindings for POST /settle, one row per (merchant, key)';
comment on column settle_idempotency.fingerprint is 'sha256 of the logical charge the key was first used for';
comment on column settle_idempotency.nonce is 'Payment the key resolves to; rebound only when that payment failed';
