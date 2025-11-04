'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [loading, setLoading] = useState(false);
  
  // Form state
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [apiKey, setApiKey] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, name, email, description }),
      });

      if (res.ok) {
        const data = await res.json();
        setApiKey(data.apiKey);
        setStep('success');
      } else {
        const error = await res.json();
        alert(`Registration failed: ${error.error}`);
      }
    } catch (error) {
      alert('Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'success') {
    return (
      <div className="container" style={{ maxWidth: '800px', margin: '40px auto' }}>
        <div className="card">
          <h1 style={{ color: '#28A0F0' }}>Registration Submitted!</h1>
          
          <div style={{ background: '#dc3545', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '3px solid #a71d2a' }}>
            <h3 style={{ marginTop: 0, color: '#fff' }}>CRITICAL: Save Your API Key Immediately</h3>
            <div style={{ background: '#fff', padding: '15px', borderRadius: '4px', marginBottom: '15px' }}>
              <p style={{ margin: '0 0 10px 0', color: '#dc3545', fontWeight: 'bold', fontSize: '16px' }}>
                This is your only chance to see this API key!
              </p>
              <ul style={{ margin: '10px 0', paddingLeft: '20px', color: '#721c24' }}>
                <li><strong>This key will never be shown again</strong></li>
                <li><strong>Admins cannot retrieve it for you</strong></li>
                <li><strong>If you lose it, you must register a new merchant</strong></li>
                <li><strong>Copy it to a secure password manager NOW</strong></li>
              </ul>
            </div>
            <div style={{ background: '#fff', padding: '15px', borderRadius: '4px' }}>
              <p style={{ margin: '0 0 10px 0', fontWeight: 'bold', color: '#000' }}>Your API Key:</p>
              <code style={{
                display: 'block',
                padding: '15px',
                background: '#f8f9fa',
                border: '2px solid #dc3545',
                borderRadius: '4px',
                wordBreak: 'break-all',
                fontSize: '14px',
                fontFamily: 'monospace',
                color: '#000'
              }}>
                {apiKey}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(apiKey);
                  alert('API key copied to clipboard!');
                }}
                style={{
                  marginTop: '10px',
                  padding: '10px 20px',
                  background: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 'bold'
                }}
              >
                Copy to Clipboard
              </button>
            </div>
          </div>

          <div className="card" style={{ border: '1px solid #28A0F0' }}>
            <h3 style={{ color: '#28A0F0' }}>What's Next?</h3>
            <ol style={{ lineHeight: '1.8', color: '#8b949e' }}>
              <li><strong style={{ color: '#e6edf3' }}>Save your API key</strong> in a secure location (password manager, secrets vault)</li>
              <li><strong style={{ color: '#e6edf3' }}>Wait for approval</strong> - An admin will review your request within 24 hours</li>
              <li><strong style={{ color: '#e6edf3' }}>Receive notification</strong> - You'll be notified via email when approved</li>
              <li><strong style={{ color: '#e6edf3' }}>Start integrating</strong> - Use the integration guide below</li>
            </ol>
          </div>

          <div style={{ marginTop: '30px' }}>
            <h2 style={{ color: '#28A0F0' }}>Integration Guide</h2>
            <IntegrationGuide merchantAddress={address} apiKey={apiKey} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '800px', margin: '40px auto' }}>
      <div className="card">
        <h1 style={{ color: '#28A0F0' }}>Register as a Merchant</h1>
        <p style={{ fontSize: '16px', color: '#8b949e', marginBottom: '30px' }}>
          Register your application to accept USDC payments via the x402 protocol on Arbitrum.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Merchant Wallet Address *</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x..."
              required
              pattern="0x[a-fA-F0-9]{40}"
              title="Must be a valid Ethereum address"
            />
            <small style={{ color: '#8b949e', display: 'block', marginTop: '5px' }}>
              The address where you'll receive USDC payments
            </small>
          </div>

          <div className="form-group">
            <label>Application Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome App"
              required
              maxLength={100}
            />
          </div>

          <div className="form-group">
            <label>Contact Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
            <small style={{ color: '#8b949e', display: 'block', marginTop: '5px' }}>
              We'll notify you when your application is approved
            </small>
          </div>

          <div className="form-group">
            <label>Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Briefly describe your application and use case..."
              required
              rows={4}
              maxLength={500}
              style={{ resize: 'vertical' }}
            />
            <small style={{ color: '#8b949e', display: 'block', marginTop: '5px' }}>
              {description.length}/500 characters
            </small>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Submitting...' : 'Submit Registration'}
          </button>
        </form>

        <div className="card" style={{ marginTop: '40px', border: '1px solid #28A0F0' }}>
          <h3 style={{ marginTop: 0, color: '#28A0F0' }}>What happens after registration?</h3>
          <ul style={{ lineHeight: '1.8', color: '#8b949e' }}>
            <li><strong style={{ color: '#e6edf3' }}>You'll receive an API key immediately</strong> (save it securely!)</li>
            <li><strong style={{ color: '#e6edf3' }}>Your registration will be reviewed</strong> by an admin</li>
            <li><strong style={{ color: '#e6edf3' }}>Once approved</strong>, you can start accepting payments</li>
            <li><strong style={{ color: '#e6edf3' }}>You'll receive an email notification</strong> when approved</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function IntegrationGuide({ merchantAddress, apiKey }: { merchantAddress: string; apiKey: string }) {
  return (
    <div className="card" style={{ border: '1px solid #2d3e54' }}>
      <h3 style={{ color: '#28A0F0' }}>Quick Start Integration</h3>
      
      <h4 style={{ color: '#e6edf3' }}>1. Install Dependencies</h4>
      <pre style={{ background: '#0d1a2d', padding: '15px', borderRadius: '4px', overflow: 'auto' }}>
        <code style={{ color: '#8b949e' }}>npm install viem</code>
      </pre>

      <h4 style={{ color: '#e6edf3' }}>2. Create Payment Requirements</h4>
      <pre style={{ background: '#0d1a2d', padding: '15px', borderRadius: '4px', overflow: 'auto' }}>
        <code style={{ color: '#8b949e' }}>{`const paymentRequirements = {
  merchantAddress: "${merchantAddress}",
  amount: 1000000 // 1 USDC (6 decimals)
  // Note: network and token are validated by facilitator
};`}</code>
      </pre>

      <h4 style={{ color: '#e6edf3' }}>3. Return 402 Response</h4>
      <pre style={{ background: '#0d1a2d', padding: '15px', borderRadius: '4px', overflow: 'auto' }}>
        <code style={{ color: '#8b949e' }}>{`// In your API endpoint
res.status(402).json({
  paymentRequirements,
  verifyEndpoint: "https://facilitator.example.com/verify",
  settleEndpoint: "https://facilitator.example.com/settle"
});`}</code>
      </pre>

      <h4 style={{ color: '#e6edf3' }}>4. Settle Payment (Backend)</h4>
      <div style={{ background: '#3d2a00', padding: '15px', borderRadius: '4px', marginBottom: '10px', border: '1px solid #ffc107' }}>
        <strong style={{ color: '#ffc107' }}>Security Warning:</strong>
        <p style={{ margin: '5px 0 0 0', color: '#ffda6a' }}>
          Never expose your API key in client-side code! Always call the settlement endpoint from your backend server.
        </p>
      </div>
      <pre style={{ background: '#0d1a2d', padding: '15px', borderRadius: '4px', overflow: 'auto' }}>
        <code style={{ color: '#8b949e' }}>{`// BACKEND ONLY: Never run this in the browser!
const response = await fetch("https://facilitator.example.com/settle", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": "${apiKey.slice(0, 16)}..." // Your API key
  },
  body: JSON.stringify({
    paymentPayload, // From client
    paymentRequirements
  })
});

const result = await response.json();
if (result.success) {
  // Payment confirmed!
  console.log("TX Hash:", result.outgoingTransactionHash);
}`}</code>
      </pre>

      <h4 style={{ color: '#e6edf3' }}>5. Full Example</h4>
      <p>
        <a 
          href="https://github.com/hummusonrails/x402-facilitator/tree/main/x402-examples" 
          target="_blank"
          style={{ color: '#28A0F0', textDecoration: 'none' }}
        >
          View complete integration examples →
        </a>
      </p>

      <div style={{ marginTop: '20px', padding: '15px', background: '#0d2438', borderRadius: '4px', border: '1px solid #28A0F0' }}>
        <strong style={{ color: '#28A0F0' }}>Documentation:</strong>
        <ul style={{ marginBottom: 0, color: '#8b949e' }}>
          <li>
            <a 
              href="https://github.com/hummusonrails/x402-facilitator/blob/main/docs/INTEGRATION_GUIDE.md" 
              target="_blank"
              style={{ color: '#28A0F0' }}
            >
              Full Integration Guide
            </a>
          </li>
          <li>
            <a 
              href="https://github.com/hummusonrails/x402-facilitator/blob/main/x402-examples/QUICK_START.md" 
              target="_blank"
              style={{ color: '#28A0F0' }}
            >
              Quick Start Guide
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
