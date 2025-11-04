'use client';

import { usePathname } from 'next/navigation';

export default function Navigation() {
  const pathname = usePathname();
  const isLoginPage = pathname === '/login';
  const isRegisterPage = pathname === '/register';
  const isAuthenticatedPage = pathname === '/admin' || pathname === '/merchants';

  return (
    <nav style={{
      background: '#2c3e50',
      padding: '15px 30px',
      color: 'white',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <div style={{ fontSize: '20px', fontWeight: 'bold' }}>
        <a href="/" style={{ color: 'white', textDecoration: 'none' }}>
          X402 Facilitator
        </a>
      </div>
      <div style={{ display: 'flex', gap: '20px' }}>
        {!isAuthenticatedPage && !isLoginPage && (
          <a href="/register" style={{ color: 'white', textDecoration: 'none' }}>
            Register as Merchant
          </a>
        )}
        {!isAuthenticatedPage && !isRegisterPage && (
          <a href="/login" style={{ color: 'white', textDecoration: 'none' }}>
            Admin Login
          </a>
        )}
      </div>
    </nav>
  );
}
