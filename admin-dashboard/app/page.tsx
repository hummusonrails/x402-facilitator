'use client';

export default function HomePage() {
  return (
    <div className="container" style={{ maxWidth: '1000px', margin: '40px auto' }}>
      <div className="card">
        <h1 style={{ fontSize: '36px', marginBottom: '20px', color: '#28A0F0' }}>X402arb Payment Facilitator</h1>
        <p style={{ fontSize: '18px', color: '#8b949e', marginBottom: '40px' }}>
          Accept USDC payments on Arbitrum using the x402 HTTP payment protocol
        </p>

        <div style={{ maxWidth: '600px', margin: '0 auto 40px' }}>
          <div className="card">
            <h2 style={{ marginTop: 0, color: '#28A0F0' }}>For Merchants</h2>
            <p style={{ color: '#e6edf3' }}>Register your application to start accepting USDC payments via x402 protocol.</p>
            <ul style={{ lineHeight: '1.8', color: '#8b949e' }}>
              <li>Instant API key generation</li>
              <li>Simple integration guide</li>
              <li>Support for Arbitrum mainnet & Sepolia</li>
              <li>Automatic fee collection</li>
            </ul>
            <a href="/register" className="btn btn-primary" style={{ display: 'inline-block', marginTop: '20px', textDecoration: 'none' }}>
              Register as Merchant
            </a>
          </div>
        </div>

        <div className="card" style={{ border: '1px solid #28A0F0' }}>
          <h3 style={{ marginTop: 0, color: '#28A0F0' }}>How It Works</h3>
          <ol style={{ lineHeight: '1.8', color: '#8b949e' }}>
            <li><strong style={{ color: '#e6edf3' }}>Register:</strong> Submit your merchant application with wallet address</li>
            <li><strong style={{ color: '#e6edf3' }}>Receive API Key:</strong> Get your API key immediately (save it securely!)</li>
            <li><strong style={{ color: '#e6edf3' }}>Wait for Approval:</strong> Admin reviews your application (usually within 24 hours)</li>
            <li><strong style={{ color: '#e6edf3' }}>Integrate:</strong> Follow the integration guide to add x402 payments to your app</li>
            <li><strong style={{ color: '#e6edf3' }}>Accept Payments:</strong> Start receiving USDC payments on Arbitrum</li>
          </ol>
        </div>

      </div>
    </div>
  );
}
