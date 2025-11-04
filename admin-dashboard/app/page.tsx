'use client';

export default function HomePage() {
  return (
    <div className="container" style={{ maxWidth: '1000px', margin: '40px auto' }}>
      <div className="card">
        <h1 style={{ fontSize: '36px', marginBottom: '20px' }}>X402 Payment Facilitator</h1>
        <p style={{ fontSize: '18px', color: '#666', marginBottom: '40px' }}>
          Accept USDC payments on Arbitrum using the x402 HTTP payment protocol
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '40px' }}>
          <div className="card" style={{ background: '#f8f9fa' }}>
            <h2 style={{ marginTop: 0 }}>For Merchants</h2>
            <p>Register your application to start accepting USDC payments via x402 protocol.</p>
            <ul style={{ lineHeight: '1.8' }}>
              <li>Instant API key generation</li>
              <li>Simple integration guide</li>
              <li>Support for Arbitrum mainnet & Sepolia</li>
              <li>Automatic fee collection</li>
            </ul>
            <a href="/register" className="btn btn-primary" style={{ display: 'inline-block', marginTop: '20px' }}>
              Register as Merchant
            </a>
          </div>

          <div className="card" style={{ background: '#f8f9fa' }}>
            <h2 style={{ marginTop: 0 }}>For Administrators</h2>
            <p>Manage merchants, view payments, and process refunds.</p>
            <ul style={{ lineHeight: '1.8' }}>
              <li>Approve/reject merchant registrations</li>
              <li>Monitor payment activity</li>
              <li>Execute manual refunds</li>
              <li>Manage merchant status</li>
            </ul>
            <a href="/admin" className="btn btn-primary" style={{ display: 'inline-block', marginTop: '20px' }}>
              Admin Dashboard
            </a>
          </div>
        </div>

        <div className="card" style={{ background: '#e7f3ff', border: '1px solid #b3d9ff' }}>
          <h3 style={{ marginTop: 0 }}>How It Works</h3>
          <ol style={{ lineHeight: '1.8' }}>
            <li><strong>Register:</strong> Submit your merchant application with wallet address</li>
            <li><strong>Receive API Key:</strong> Get your API key immediately (save it securely!)</li>
            <li><strong>Wait for Approval:</strong> Admin reviews your application (usually within 24 hours)</li>
            <li><strong>Integrate:</strong> Follow the integration guide to add x402 payments to your app</li>
            <li><strong>Accept Payments:</strong> Start receiving USDC payments on Arbitrum</li>
          </ol>
        </div>

        <div style={{ marginTop: '40px' }}>
          <h3>Features</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
            <div>
              <h4>EIP-3009 Support</h4>
              <p style={{ fontSize: '14px', color: '#666' }}>
                Secure transfer authorizations with signature verification
              </p>
            </div>
            <div>
              <h4>Automatic Fees</h4>
              <p style={{ fontSize: '14px', color: '#666' }}>
                Service fee (0.5%) and gas reimbursement automatically collected
              </p>
            </div>
            <div>
              <h4>Persistent Storage</h4>
              <p style={{ fontSize: '14px', color: '#666' }}>
                PostgreSQL-based nonce tracking with advisory locks
              </p>
            </div>
            <div>
              <h4>Automatic Recovery</h4>
              <p style={{ fontSize: '14px', color: '#666' }}>
                Failed settlements automatically retried with exponential backoff
              </p>
            </div>
            <div>
              <h4>Multi-Merchant</h4>
              <p style={{ fontSize: '14px', color: '#666' }}>
                Support for unlimited merchants with individual API keys
              </p>
            </div>
            <div>
              <h4>Production Ready</h4>
              <p style={{ fontSize: '14px', color: '#666' }}>
                Battle-tested with comprehensive error handling and logging
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
