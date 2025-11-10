# X402 Facilitator Admin Dashboard

Simple web-based admin dashboard for managing the X402 payment facilitator.

## Features

- **View facilitator wallet balance** (USDC and ETH)
- View payment statistics (total, completed, failed)
- **Browse recent payments with fee breakdown**
- Execute refunds for failed payments
- **Manage merchants** (add, enable/disable)
- **Generate merchant API keys** directly in the UI
- Session-based authentication

## Setup

### 1. Install Dependencies

```bash
cd admin-dashboard
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Database (same as facilitator)
DATABASE_URL=postgresql://facilitator:facilitator@localhost:5432/facilitator

# Admin credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-secure-password

# Facilitator API
FACILITATOR_API_URL=http://localhost:3002
FACILITATOR_ADMIN_KEY=your-admin-api-key
```

### 3. Run Dashboard

```bash
pnpm dev
```

Dashboard will be available at `http://localhost:3003`

## Usage

### Login

1. Navigate to `http://localhost:3003/login`
2. Enter admin credentials
3. You'll be redirected to the dashboard

### View Wallet Balance

The dashboard displays:
- **USDC Balance**: Current USDC balance in the facilitator wallet
- **ETH Balance**: Current ETH balance for gas fees
- **Wallet Address**: Facilitator's Ethereum address

Balances are updated automatically every 30 seconds.

### View Payments

The dashboard shows:
- Total payment count
- Completed payments
- Failed payments
- Total volume processed

Recent payments table displays:
- Nonce (truncated)
- Merchant address (truncated)
- Total amount in USDC
- Merchant amount (what merchant receives)
- Fee amount (facilitator's fee)
- Status
- Creation timestamp

### Execute Refund

1. Find the failed payment nonce
2. Enter nonce in refund form
3. Provide reason for refund
4. Click "Execute Refund"

The dashboard will call the facilitator's `/admin/refund` endpoint.

## Security

- Session-based authentication with HTTP-only cookies
- Admin credentials from environment variables
- All API routes check authentication
- Refund requests proxied through facilitator API

## Production Deployment

### Environment Variables

Set these in production:

```env
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
ADMIN_USERNAME=admin
ADMIN_PASSWORD=strong-random-password
FACILITATOR_API_URL=https://facilitator.yourdomain.com
FACILITATOR_ADMIN_KEY=your-production-admin-key
NODE_ENV=production
```

### Build and Run

```bash
pnpm build
pnpm start
```

### Reverse Proxy

Use nginx or similar to add HTTPS:

```nginx
server {
    listen 443 ssl;
    server_name admin.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Development

The dashboard is built with:
- Next.js 14 (App Router)
- React 18
- TypeScript
- PostgreSQL (via pg)

File structure:
```
admin-dashboard/
├── app/
│   ├── api/           # API routes
│   ├── login/         # Login page
│   ├── layout.tsx     # Root layout
│   ├── page.tsx       # Dashboard page
│   └── globals.css    # Styles
├── utils/
│   ├── db.ts          # Database queries
│   └── auth.ts        # Authentication helpers
└── package.json
```

## Troubleshooting

### Cannot connect to database

Check `DATABASE_URL` is correct and database is running:

```bash
psql $DATABASE_URL -c "SELECT NOW();"
```

### Authentication fails

Verify `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`

### Refund fails

Check:
1. `FACILITATOR_API_URL` points to running facilitator
2. `FACILITATOR_ADMIN_KEY` matches facilitator's admin key
3. Payment exists and is in `failed` status
