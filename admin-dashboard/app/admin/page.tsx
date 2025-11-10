'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Payment {
  nonce: string;
  user_address: string;
  merchant_address: string;
  total_amount: string;
  merchant_amount: string;
  fee_amount: string;
  status: string;
  incoming_tx_hash: string | null;
  outgoing_tx_hash: string | null;
  created_at: string;
}

interface Stats {
  status: string;
  count: string;
  total_volume: string;
  total_fees: string;
}

interface WalletInfo {
  balance: string;
  ethBalance: string;
  address: string;
}

export default function Dashboard() {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<Stats[]>([]);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refundNonce, setRefundNonce] = useState('');
  const [refundReason, setRefundReason] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [paymentsRes, statsRes, walletRes] = await Promise.all([
        fetch('/api/payments'),
        fetch('/api/stats'),
        fetch('/api/wallet'),
      ]);

      if (!paymentsRes.ok || !statsRes.ok) {
        router.push('/login');
        return;
      }

      const paymentsData = await paymentsRes.json();
      const statsData = await statsRes.json();

      setPayments(paymentsData);
      setStats(statsData);

      if (walletRes.ok) {
        const walletData = await walletRes.json();
        setWalletInfo(walletData);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!refundNonce || !refundReason) return;

    try {
      const res = await fetch('/api/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: refundNonce, reason: refundReason }),
      });

      if (res.ok) {
        alert('Refund executed successfully');
        setRefundNonce('');
        setRefundReason('');
        loadData();
      } else {
        const error = await res.json();
        alert(`Refund failed: ${error.error}`);
      }
    } catch (error) {
      alert('Refund request failed');
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  if (loading) {
    return <div className="container">Loading...</div>;
  }

  const totalPayments = stats.reduce((sum, s) => sum + parseInt(s.count), 0);
  const completePayments = stats.find(s => s.status === 'complete');
  const failedPayments = stats.find(s => s.status === 'failed');
  const totalFeesEarned = completePayments?.total_fees || '0';

  return (
    <div className="container">
      <div className="header">
        <h1 style={{ color: '#28A0F0' }}>X402arb: X402 Payment Facilitator Admin</h1>
        <div>
          <button onClick={() => router.push('/merchants')} className="btn btn-primary" style={{ marginRight: '10px' }}>
            Manage Merchants
          </button>
          <button onClick={handleLogout} className="btn btn-primary">
            Logout
          </button>
        </div>
      </div>

      {/* Wallet Balance Section */}
      <div className="wallet-balance-row">
        <div className="wallet-balance-card">
          <h3>USDC Balance</h3>
          <div className="value">
            {walletInfo ? (parseInt(walletInfo.balance) / 1e6).toFixed(2) : '0.00'} USDC
          </div>
        </div>
        <div className="wallet-balance-card">
          <h3>ETH Balance</h3>
          <div className="value">
            {walletInfo ? (parseInt(walletInfo.ethBalance) / 1e18).toFixed(4) : '0.0000'} ETH
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats">
        <div className="stat-card">
          <h3>Total Fees Earned</h3>
          <div className="value">
            {(parseInt(totalFeesEarned) / 1e6).toFixed(2)} USDC
          </div>
        </div>
        <div className="stat-card">
          <h3>Total Payments</h3>
          <div className="value">{totalPayments}</div>
        </div>
        <div className="stat-card">
          <h3>Completed</h3>
          <div className="value">{completePayments?.count || 0}</div>
        </div>
        <div className="stat-card">
          <h3>Failed</h3>
          <div className="value">{failedPayments?.count || 0}</div>
        </div>
        <div className="stat-card">
          <h3>Total Volume</h3>
          <div className="value">
            {(parseInt(completePayments?.total_volume || '0') / 1e6).toFixed(2)} USDC
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ color: '#28A0F0' }}>Process Refund</h2>
        <form onSubmit={handleRefund}>
          <div className="form-group">
            <label>Nonce</label>
            <input
              type="text"
              value={refundNonce}
              onChange={(e) => setRefundNonce(e.target.value)}
              placeholder="0x..."
              required
            />
          </div>
          <div className="form-group">
            <label>Reason</label>
            <input
              type="text"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Settlement failed after max retries"
              required
            />
          </div>
          <button type="submit" className="btn btn-danger">
            Execute Refund
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ color: '#28A0F0' }}>Recent Payments</h2>
        <table>
          <thead>
            <tr>
              <th>Nonce</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Fee Earned</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.nonce}>
                <td className="mono">{payment.nonce.slice(0, 10)}...</td>
                <td className="mono">{payment.merchant_address.slice(0, 10)}...</td>
                <td>{(parseInt(payment.total_amount) / 1e6).toFixed(2)} USDC</td>
                <td style={{ color: '#28A0F0', fontWeight: 'bold' }}>
                  {(parseInt(payment.fee_amount || '0') / 1e6).toFixed(2)} USDC
                </td>
                <td>
                  <span className={`status status-${payment.status}`}>
                    {payment.status}
                  </span>
                </td>
                <td>{new Date(payment.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
