'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Merchant {
  address: string;
  name: string;
  enabled: boolean;
  approved: boolean;
  rate_limit: number;
  created_at: string;
  requested_at: string;
  email: string;
  description: string;
}

export default function MerchantsPage() {
  const router = useRouter();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [emailNotification, setEmailNotification] = useState<{
    type: 'approval' | 'rejection';
    merchant: Merchant;
    reason?: string;
  } | null>(null);
  
  // Form state
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [generatedHash, setGeneratedHash] = useState('');

  useEffect(() => {
    loadMerchants();
  }, []);

  async function loadMerchants() {
    try {
      const res = await fetch('/api/merchants', {
        credentials: 'include', // Important: include cookies
      });
      
      if (res.status === 401) {
        console.log('Not authenticated, redirecting to login');
        router.push('/login');
        return;
      }
      
      if (!res.ok) {
        console.error('Failed to load merchants:', res.status);
        return;
      }
      
      const data = await res.json();
      setMerchants(data);
    } catch (error) {
      console.error('Failed to load merchants:', error);
    } finally {
      setLoading(false);
    }
  }

  async function generateApiKey() {
    try {
      const res = await fetch('/api/merchants/generate-key', {
        method: 'POST',
        credentials: 'include',
      });
      
      if (res.ok) {
        const data = await res.json();
        setGeneratedKey(data.apiKey);
        setGeneratedHash(data.hash);
      } else {
        alert('Failed to generate API key');
      }
    } catch (error) {
      alert('Failed to generate API key');
    }
  }

  async function handleAddMerchant(e: React.FormEvent) {
    e.preventDefault();
    
    if (!address || !name || !generatedHash) {
      alert('Please fill all fields and generate an API key');
      return;
    }

    try {
      const res = await fetch('/api/merchants/add', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, name, apiKeyHash: generatedHash }),
      });

      if (res.ok) {
        alert(`Merchant added successfully!\n\nAPI Key (give to merchant):\n${generatedKey}\n\nStore this securely - it won't be shown again!`);
        setShowAddForm(false);
        setAddress('');
        setName('');
        setGeneratedKey('');
        setGeneratedHash('');
        loadMerchants();
      } else {
        const error = await res.json();
        alert(`Failed to add merchant: ${error.error}`);
      }
    } catch (error) {
      alert('Failed to add merchant');
    }
  }

  async function toggleMerchant(merchantAddress: string, enabled: boolean) {
    try {
      const res = await fetch('/api/merchants/toggle', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: merchantAddress, enabled: !enabled }),
      });

      if (res.ok) {
        loadMerchants();
      } else {
        alert('Failed to update merchant');
      }
    } catch (error) {
      alert('Failed to update merchant');
    }
  }

  async function approveMerchant(merchant: Merchant) {
    if (!confirm(`Approve merchant: ${merchant.name}?`)) return;

    try {
      const res = await fetch('/api/merchants/approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: merchant.address, approved: true }),
      });

      if (res.ok) {
        setEmailNotification({
          type: 'approval',
          merchant,
        });
        loadMerchants();
      } else {
        alert('Failed to approve merchant');
      }
    } catch (error) {
      alert('Failed to approve merchant');
    }
  }

  async function rejectMerchant(merchant: Merchant) {
    const reason = prompt('Reason for rejection:');
    if (!reason) return;

    try {
      const res = await fetch('/api/merchants/approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: merchant.address, approved: false, rejectionReason: reason }),
      });

      if (res.ok) {
        setEmailNotification({
          type: 'rejection',
          merchant,
          reason,
        });
        loadMerchants();
      } else {
        alert('Failed to reject merchant');
      }
    } catch (error) {
      alert('Failed to reject merchant');
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  if (loading) {
    return <div className="container">Loading...</div>;
  }

  return (
    <div className="container">
      <div className="header">
        <h1>Merchant Management</h1>
        <div>
          <button onClick={() => router.push('/admin')} className="btn btn-primary" style={{ marginRight: '10px' }}>
            Dashboard
          </button>
          <button onClick={handleLogout} className="btn btn-primary">
            Logout
          </button>
        </div>
      </div>

      {emailNotification && (
        <div className="card" style={{ background: emailNotification.type === 'approval' ? '#d4edda' : '#f8d7da', border: `1px solid ${emailNotification.type === 'approval' ? '#c3e6cb' : '#f5c6cb'}`, marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <h3 style={{ marginTop: 0, color: emailNotification.type === 'approval' ? '#155724' : '#721c24' }}>
                {emailNotification.type === 'approval' ? 'Merchant Approved' : 'Merchant Rejected'} - Send Email Notification
              </h3>
              <div style={{ marginBottom: '15px' }}>
                <strong>To:</strong> {emailNotification.merchant.email}
              </div>
              <div style={{ marginBottom: '15px' }}>
                <strong>Subject:</strong> {emailNotification.type === 'approval' 
                  ? 'Your x402 Merchant Account Has Been Approved' 
                  : 'Your x402 Merchant Application Status'}
              </div>
              <div style={{ background: 'white', padding: '15px', borderRadius: '4px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '14px' }}>
                {emailNotification.type === 'approval' ? (
                  `Hi ${emailNotification.merchant.name},

Your merchant account has been approved and is now active. You can start accepting payments immediately.

Best regards,
X402 Facilitator Team`
                ) : (
                  `Hi ${emailNotification.merchant.name},

Unfortunately, we cannot approve your merchant application at this time.

Reason: ${emailNotification.reason}

If you have questions, please contact support.

Best regards,
X402 Facilitator Team`
                )}
              </div>
            </div>
            <button 
              onClick={() => setEmailNotification(null)}
              style={{ 
                background: 'transparent', 
                border: 'none', 
                fontSize: '24px', 
                cursor: 'pointer',
                padding: '0 10px',
                color: '#666'
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>Registered Merchants ({merchants.length})</h2>
          <button 
            onClick={() => setShowAddForm(!showAddForm)} 
            className="btn btn-primary"
          >
            {showAddForm ? 'Cancel' : 'Add Merchant'}
          </button>
        </div>

        {showAddForm && (
          <div className="card" style={{ background: '#f9f9f9', marginBottom: '20px' }}>
            <h3>Add New Merchant</h3>
            <form onSubmit={handleAddMerchant}>
              <div className="form-group">
                <label>Merchant Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="0x..."
                  required
                />
              </div>
              <div className="form-group">
                <label>Merchant Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Merchant A"
                  required
                />
              </div>
              <div className="form-group">
                <label>API Key</label>
                <button 
                  type="button" 
                  onClick={generateApiKey} 
                  className="btn btn-primary"
                  style={{ marginBottom: '10px' }}
                >
                  Generate API Key
                </button>
                {generatedKey && (
                  <div style={{ background: 'white', padding: '15px', borderRadius: '4px', marginTop: '10px' }}>
                    <p style={{ margin: '0 0 10px 0', fontWeight: 'bold', color: '#d9534f' }}>
                      Save this key now - it won't be shown again!
                    </p>
                    <p style={{ margin: '0 0 5px 0', fontSize: '12px', fontWeight: 'bold' }}>
                      API Key (give to merchant):
                    </p>
                    <code style={{ 
                      display: 'block', 
                      padding: '10px', 
                      background: '#f5f5f5', 
                      borderRadius: '4px',
                      wordBreak: 'break-all',
                      fontSize: '12px'
                    }}>
                      {generatedKey}
                    </code>
                  </div>
                )}
              </div>
              <button type="submit" className="btn btn-primary" disabled={!generatedHash}>
                Add Merchant
              </button>
            </form>
          </div>
        )}

        <table>
          <thead>
            <tr>
              <th>Address</th>
              <th>Name</th>
              <th>Email</th>
              <th>Description</th>
              <th>Approval</th>
              <th>Status</th>
              <th>Rate Limit</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {merchants.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                  No merchants registered. Click "Add Merchant" to get started.
                </td>
              </tr>
            ) : (
              merchants.map((merchant) => (
                <tr key={merchant.address} style={{ background: !merchant.approved ? '#fff3cd' : 'transparent' }}>
                  <td className="mono">{merchant.address.slice(0, 10)}...{merchant.address.slice(-8)}</td>
                  <td>{merchant.name}</td>
                  <td>{merchant.email || 'N/A'}</td>
                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={merchant.description}>
                    {merchant.description || 'N/A'}
                  </td>
                  <td>
                    {!merchant.approved ? (
                      <span className="status" style={{ background: '#ffc107', color: '#000' }}>
                        Pending
                      </span>
                    ) : (
                      <span className="status status-complete">
                        Approved
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`status ${merchant.enabled ? 'status-complete' : 'status-failed'}`}>
                      {merchant.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td>{merchant.rate_limit} req/15min</td>
                  <td>{new Date(merchant.requested_at || merchant.created_at).toLocaleDateString()}</td>
                  <td>
                    {!merchant.approved ? (
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                          onClick={() => approveMerchant(merchant)}
                          className="btn btn-primary"
                          style={{ fontSize: '12px', padding: '6px 12px' }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => rejectMerchant(merchant)}
                          className="btn btn-danger"
                          style={{ fontSize: '12px', padding: '6px 12px' }}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => toggleMerchant(merchant.address, merchant.enabled)}
                        className={`btn ${merchant.enabled ? 'btn-danger' : 'btn-primary'}`}
                        style={{ fontSize: '12px', padding: '6px 12px' }}
                      >
                        {merchant.enabled ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
