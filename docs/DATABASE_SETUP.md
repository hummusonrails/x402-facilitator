# Database Setup Guide

## Overview

The x402 facilitator uses PostgreSQL for persistent nonce storage and payment tracking. This ensures:
- **Nonce uniqueness** across restarts
- **Payment state tracking** through the two-step settlement flow
- **Audit trail** with immutable event logs
- **Recovery capability** for incomplete settlements

## Quick Start (Local Development)

### 1. Configure Environment

```bash
cd facilitator
cp .env.example .env
```

Edit `.env` and set a secure password:

```bash
POSTGRES_USER=facilitator
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=facilitator
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
```

### Local Development (Docker)

Start PostgreSQL with Docker Compose:

```bash
cd facilitator
docker-compose up -d
```

**Important:** If you see warnings about undefined variables from bcrypt hashes, you need to escape `$` symbols in your `.env` file:

```env
# Wrong (causes warnings):
ADMIN_API_KEY_HASH=$2b$10$abc...

# Correct (no warnings):
ADMIN_API_KEY_HASH=$$2b$$10$$abc...
```

Docker Compose interprets `$` as variable substitution, so bcrypt hashes need `$$` instead of `$`.

This starts a PostgreSQL 16 container with:
- Database: From `POSTGRES_DB` (default: `facilitator`)
- User: From `POSTGRES_USER` (default: `facilitator`)
- Password: From `POSTGRES_PASSWORD` (**must be changed from default**)
- Port: From `POSTGRES_PORT` (default: `5432`)

### 3. Run Migrations

The migrations are automatically applied when the container starts (via `docker-entrypoint-initdb.d`).

To manually run migrations (using your configured password):

```bash
psql "$DATABASE_URL" -f migrations/001_init.sql
```

### 4. Verify Configuration

The `DATABASE_URL` is automatically constructed from your environment variables:

```bash
# This is set in .env:
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}
```

### 5. Start the Facilitator

```bash
pnpm dev
```

You should see:

```
✓ Database connection successful
✓ Chain ID validated
✓ Token decimals validated
✓ All startup validations passed
✓ X402 Facilitator listening at http://localhost:3002
```

## Production Setup

### Option 1: Managed PostgreSQL (Recommended)

Use a managed database service:

- **AWS RDS** (PostgreSQL 14+)
- **Google Cloud SQL**
- **Azure Database for PostgreSQL**
- **Supabase**
- **Neon**
- **Railway**

#### Setup Steps:

1. Create a PostgreSQL database
2. Note the connection string
3. Run migrations:

```bash
psql $DATABASE_URL -f facilitator/migrations/001_init.sql
```

4. Configure environment:

```bash
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
PGSSL=true
```

### Option 2: Self-Hosted PostgreSQL

#### Install PostgreSQL

```bash
# Ubuntu/Debian
sudo apt-get install postgresql-16

# macOS
brew install postgresql@16
```

#### Create Database

```bash
sudo -u postgres psql

CREATE DATABASE facilitator;
CREATE USER facilitator WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE facilitator TO facilitator;
\q
```

#### Configure Environment

```bash
# In .env
POSTGRES_USER=facilitator
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=facilitator
POSTGRES_HOST=localhost
POSTGRES_PORT=5432

# DATABASE_URL is auto-constructed from above
```

#### Run Migrations

```bash
# Initial schema
psql "$DATABASE_URL" -f facilitator/migrations/001_init.sql

# Merchant management (if using merchant features)
psql "$DATABASE_URL" -f facilitator/migrations/002_merchants.sql
psql "$DATABASE_URL" -f facilitator/migrations/003_merchant_approval.sql
psql "$DATABASE_URL" -f facilitator/migrations/004_merchant_contact_info.sql

# Fee tracking (required for admin dashboard)
psql "$DATABASE_URL" -f facilitator/migrations/005_add_fee_columns.sql
```

## Database Schema

### `payments` Table

Tracks payment state through the settlement flow.

| Column | Type | Description |
|--------|------|-------------|
| `nonce` | text (PK) | EIP-3009 nonce (unique identifier) |
| `user_address` | bytea | User's Ethereum address |
| `merchant_address` | bytea | Merchant's Ethereum address |
| `token_address` | bytea | USDC contract address |
| `network` | text | Network (arbitrum, arbitrum-sepolia) |
| `total_amount` | numeric(78,0) | Total amount in base units |
| `merchant_amount` | numeric(78,0) | Amount merchant receives (excluding fees) |
| `fee_amount` | numeric(78,0) | Facilitator's fee (service + gas) |
| `incoming_tx_hash` | bytea | User → Facilitator tx hash |
| `outgoing_tx_hash` | bytea | Facilitator → Merchant tx hash |
| `status` | text | State machine status |
| `created_at` | timestamptz | Record creation time |
| `updated_at` | timestamptz | Last update time |

### Payment Status State Machine

```
pending
  ↓
incoming_submitted (tx1 hash stored)
  ↓
incoming_complete (tx1 confirmed)
  ↓
outgoing_submitted (tx2 hash stored)
  ↓
complete (tx2 confirmed)

OR

failed (terminal state)
```

### `payment_events` Table

Immutable audit trail of all payment events.

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigserial (PK) | Auto-incrementing ID |
| `nonce` | text (FK) | References payments(nonce) |
| `event_type` | text | Event type (e.g., "incoming_submitted") |
| `event_data` | jsonb | Additional event data |
| `created_at` | timestamptz | Event timestamp |

## Querying Payments

### Get Payment by Nonce

```sql
SELECT 
  nonce,
  '0x' || encode(user_address, 'hex') as user_address,
  '0x' || encode(merchant_address, 'hex') as merchant_address,
  total_amount,
  status,
  '0x' || encode(incoming_tx_hash, 'hex') as incoming_tx_hash,
  '0x' || encode(outgoing_tx_hash, 'hex') as outgoing_tx_hash,
  created_at,
  updated_at
FROM payments
WHERE nonce = '0x...';
```

### Get Incomplete Payments

```sql
SELECT *
FROM payments
WHERE status IN ('incoming_complete', 'outgoing_submitted')
ORDER BY created_at ASC;
```

### Get Failed Payments

```sql
SELECT 
  nonce,
  '0x' || encode(merchant_address, 'hex') as merchant,
  total_amount,
  status,
  created_at
FROM payments
WHERE status = 'failed'
ORDER BY created_at DESC;
```

### Payment Statistics

```sql
SELECT 
  status,
  COUNT(*) as count,
  SUM(total_amount) as total_volume
FROM payments
GROUP BY status;
```

### Merchant Volume

```sql
SELECT 
  '0x' || encode(merchant_address, 'hex') as merchant,
  COUNT(*) as payment_count,
  SUM(total_amount) as total_volume,
  AVG(total_amount) as avg_payment
FROM payments
WHERE status = 'complete'
GROUP BY merchant_address
ORDER BY total_volume DESC;
```

## Backup and Recovery

### Backup Database

```bash
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore Database

```bash
psql $DATABASE_URL < backup_20241104_120000.sql
```

### Automated Backups

Set up daily backups with cron:

```bash
# Add to crontab
0 2 * * * pg_dump $DATABASE_URL | gzip > /backups/facilitator_$(date +\%Y\%m\%d).sql.gz
```

## Monitoring

### Connection Pool Stats

```sql
SELECT 
  count(*) as total_connections,
  sum(CASE WHEN state = 'active' THEN 1 ELSE 0 END) as active,
  sum(CASE WHEN state = 'idle' THEN 1 ELSE 0 END) as idle
FROM pg_stat_activity
WHERE datname = 'facilitator';
```

### Table Sizes

```sql
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Recent Payments

```sql
SELECT 
  nonce,
  status,
  created_at,
  updated_at,
  updated_at - created_at as duration
FROM payments
ORDER BY created_at DESC
LIMIT 10;
```

## Troubleshooting

### Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solution:**
- Check PostgreSQL is running: `docker-compose ps`
- Check DATABASE_URL is correct
- Check firewall allows port 5432

### SSL Connection Error

```
Error: The server does not support SSL connections
```

**Solution:**
- Set `PGSSL=false` for local development
- For production, ensure database supports SSL

### Migration Already Applied

```
ERROR: relation "payments" already exists
```

**Solution:**
- Migrations are idempotent (use `CREATE TABLE IF NOT EXISTS`)
- Safe to re-run migrations

### Nonce Already Exists

```
ERROR: duplicate key value violates unique constraint "payments_pkey"
```

**Solution:**
- This is expected behavior (nonce replay protection)
- The payment will be rejected with "Nonce has already been used"

## Performance Tuning

### Indexes

The schema includes indexes on:
- `status` (for querying incomplete payments)
- `merchant_address` (for merchant queries)
- `created_at` (for time-based queries)
- `user_address` (for user history)

### Connection Pool

Adjust pool size in `src/db.ts`:

```typescript
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Increase for high traffic
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### Vacuum and Analyze

Run periodically:

```sql
VACUUM ANALYZE payments;
VACUUM ANALYZE payment_events;
```

## Security

### Database User Permissions

Grant minimal permissions:

```sql
GRANT SELECT, INSERT, UPDATE ON payments TO facilitator;
GRANT SELECT, INSERT ON payment_events TO facilitator;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO facilitator;
```

### SSL/TLS

Always use SSL in production:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
PGSSL=true
```

### Secrets Management

Never commit DATABASE_URL to git. Use:
- Environment variables
- AWS Secrets Manager
- HashiCorp Vault
- Kubernetes Secrets

## Migration Management

### Adding New Migrations

Create `facilitator/migrations/002_description.sql`:

```sql
-- Migration 002: Add refund tracking

ALTER TABLE payments ADD COLUMN refund_tx_hash bytea;
ALTER TABLE payments ADD COLUMN refunded_at timestamptz;

-- Update check constraint
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check 
  CHECK (status IN ('pending', 'incoming_submitted', 'incoming_complete', 
                    'outgoing_submitted', 'complete', 'failed', 'refunded'));
```

Run migration:

```bash
psql $DATABASE_URL -f facilitator/migrations/002_description.sql
```

## Health Checks

The facilitator automatically tests database connection on startup.

Manual health check:

```bash
psql $DATABASE_URL -c "SELECT NOW();"
```

## Next Steps

1. Set up PostgreSQL (local or production)
2. Run migrations
3. Configure DATABASE_URL
4. Start facilitator and verify connection
5. Test payment flow
6. Set up monitoring
7. Configure automated backups
