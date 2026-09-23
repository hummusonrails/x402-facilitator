export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '48px auto', padding: 16 }}>
      <h1>x402 Next.js Example</h1>
      <p>
        <code>GET /api/premium-content</code> costs $0.50 in USDC. Requests without payment get HTTP 402 with a{' '}
        <code>PAYMENT-REQUIRED</code> header; pay with an x402 client such as <code>@x402/fetch</code>.
      </p>
    </main>
  );
}
