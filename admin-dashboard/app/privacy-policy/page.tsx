'use client';

const containerStyle: React.CSSProperties = {
  maxWidth: '900px',
  margin: '40px auto',
};

const headerTextStyle: React.CSSProperties = {
  fontSize: '36px',
  marginBottom: '10px',
  color: '#28A0F0',
};

const subTextStyle: React.CSSProperties = {
  fontSize: '16px',
  color: '#8b949e',
  marginBottom: '20px',
};

const sectionStyle: React.CSSProperties = {
  marginTop: '30px',
};

const sectionHeadingStyle: React.CSSProperties = {
  color: '#e6edf3',
  fontSize: '20px',
  marginBottom: '12px',
};

const paragraphStyle: React.CSSProperties = {
  color: '#8b949e',
  lineHeight: 1.7,
  marginBottom: '12px',
};

const listStyle: React.CSSProperties = {
  marginLeft: '20px',
  color: '#8b949e',
  lineHeight: 1.7,
};

const highlightBoxStyle: React.CSSProperties = {
  background: '#0d2438',
  border: '1px solid #2d3e54',
  borderRadius: '6px',
  padding: '15px 20px',
  marginTop: '20px',
  color: '#8b949e',
  lineHeight: 1.7,
};

const lastUpdated = 'November 6, 2025';

export default function PrivacyPolicyPage() {
  return (
    <div className="container" style={containerStyle}>
      <div className="card">
        <h1 style={headerTextStyle}>Privacy Policy</h1>
        <p style={subTextStyle}>Last updated: {lastUpdated}</p>
        <p style={paragraphStyle}>
          This policy describes what data is collected by the Arbitrum x402 Facilitator and how it is used.
        </p>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>1. Summary</h2>
          <p style={paragraphStyle}>
            The Service does not collect unnecessary personal data and does not perform tracking or analytics. Data stored is
            limited to what is required for payment processing, merchant management, and system security.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>2. Onchain Data</h2>
          <p style={paragraphStyle}>
            All payment activity is recorded on the Arbitrum blockchain and is publicly visible. This includes wallet addresses,
            token transfers, transaction hashes, and smart contract interactions. These records are immutable and outside of the
            control of the Service operator.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>3. Offchain Data Stored in the Database</h2>
          <p style={paragraphStyle}>In addition to onchain data, the Service stores a minimal set of operational data, including:</p>
          <ul style={listStyle}>
            <li>Merchant registration details (name, wallet address, email, description)</li>
            <li>Hashed API keys (never stored in plain text)</li>
            <li>
              Payment metadata such as nonce, merchant address, and user address (in hex format), total amount, payment status,
              timestamps, incoming and outgoing transaction hashes, and error logs or refund reasons for failed transactions
            </li>
            <li>Admin credentials and session data for the dashboard (in hashed or session-cookie form)</li>
          </ul>
          <p style={paragraphStyle}>
            No raw private keys, customer names, or payment card information are ever stored.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>4. How Data Is Used</h2>
          <p style={paragraphStyle}>Data is used solely to:</p>
          <ul style={listStyle}>
            <li>Facilitate payments and refunds</li>
            <li>Manage merchants and API authentication</li>
            <li>Maintain rate limits and prevent abuse</li>
            <li>Provide aggregate statistics within the admin dashboard</li>
          </ul>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>5. Data Sharing</h2>
          <p style={paragraphStyle}>
            Data is not shared or sold to any third party. Some payment details are public by design due to blockchain transparency.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>6. Data Security</h2>
          <p style={paragraphStyle}>
            Reasonable measures are taken to secure database access and API credentials, including encryption in transit (HTTPS),
            hashed secrets, and limited access by the maintainer.
          </p>
          <div style={highlightBoxStyle}>
            <strong style={{ color: '#28A0F0' }}>Security Best Practices:</strong>
            <ul style={listStyle}>
              <li>Save API keys in trusted secret managers</li>
              <li>Rotate credentials if compromise is suspected</li>
              <li>Audit access logs regularly</li>
            </ul>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>7. Cookies</h2>
          <p style={paragraphStyle}>
            The admin dashboard uses HTTP-only session cookies for authentication. No tracking or analytics cookies are used.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>8. Contact</h2>
          <p style={paragraphStyle}>
            For questions about this policy, raise an issue in the GitHub repository at{' '}
            <a href="https://github.com/hummusonrails/x402-facilitator" target="_blank" rel="noopener noreferrer" style={{ color: '#28A0F0' }}>
              https://github.com/hummusonrails/x402-facilitator
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
