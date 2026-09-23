export const metadata = {
  title: 'x402 Next.js Example',
  description: 'Paid API route settled through the Arbitrum x402 facilitator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
