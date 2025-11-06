'use client';

import {
  containerStyle,
  headerTextStyle,
  highlightBoxStyle,
  listStyle,
  paragraphStyle,
  sectionHeadingStyle,
  sectionStyle,
  subTextStyle,
} from '../components/LegalPageStyles';

const lastUpdated = 'November 6, 2025';

export default function TermsOfServicePage() {
  return (
    <div className="container" style={containerStyle}>
      <div className="card">
        <h1 style={headerTextStyle}>Terms of Service</h1>
        <p style={subTextStyle}>Last updated: {lastUpdated}</p>
        <p style={paragraphStyle}>
          Welcome to the Arbitrum x402 Facilitator project (the “Service”). By accessing or using this Service, you
          agree to the following terms. Please review them carefully.
        </p>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>1. No Warranties</h2>
          <p style={paragraphStyle}>
            The Service is provided <strong style={{ color: '#e6edf3' }}>as is</strong> and <strong style={{ color: '#e6edf3' }}>as available</strong> without any warranties, express or
            implied. This includes, but is not limited to, implied warranties of merchantability, fitness for a particular
            purpose, or non-infringement.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>2. Use at Your Own Risk</h2>
          <p style={paragraphStyle}>
            You acknowledge that this Service is experimental open-source software. Use of the Service is entirely at your
            own risk. You are solely responsible for safeguarding any wallets, private keys, or credentials used in
            conjunction with the Service.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>3. No Liability</h2>
          <p style={paragraphStyle}>
            Under no circumstances will the maintainer or contributors be liable for any loss of funds, lost data, security
            breaches, downtime, or any indirect, incidental, or consequential damages arising from your use of the Service.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>4. Open-Source Software</h2>
          <p style={paragraphStyle}>
            The Service is distributed under the MIT License. By using or contributing, you agree to the terms of that license.
            You can review the full license in the project repository.
          </p>
          <div style={highlightBoxStyle}>
            <strong style={{ color: '#28A0F0' }}>Open Source Reminder:</strong>
            <ul style={listStyle}>
              <li>You are free to inspect, fork, and contribute to the codebase.</li>
              <li>Contributions must comply with the MIT License.</li>
              <li>Consider opening issues or pull requests for enhancements.</li>
            </ul>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>5. External Links and Integrations</h2>
          <p style={paragraphStyle}>
            Links to third-party services or smart contracts are provided for convenience only. The maintainer does not
            endorse or control those external resources and assumes no responsibility for them.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>6. Modifications</h2>
          <p style={paragraphStyle}>
            These terms may be updated from time to time. Continued use of the Service after changes constitutes acceptance
            of the revised terms. Please review this page periodically for updates.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={sectionHeadingStyle}>7. Governing Law</h2>
          <p style={paragraphStyle}>
            These terms are governed by the laws of the State of Israel, without regard to conflict-of-law principles.
          </p>
        </div>
      </div>
    </div>
  );
}
