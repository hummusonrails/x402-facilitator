import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin-session');

  if (session?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const facilitatorUrl = process.env.FACILITATOR_API_URL || 'http://localhost:3002';
    const adminKey = process.env.FACILITATOR_ADMIN_KEY;

    const response = await fetch(`${facilitatorUrl}/admin/wallet`, {
      method: 'GET',
      headers: {
        'X-Admin-Key': adminKey || '',
      },
    });

    if (!response.ok) {
      // Return default wallet info if endpoint doesn't exist
      return NextResponse.json({ 
        balance: '0',
        ethBalance: '0',
        address: 'N/A'
      });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch wallet balance:', error);
    // Return default wallet info on error
    return NextResponse.json({ 
      balance: '0',
      ethBalance: '0',
      address: 'N/A'
    });
  }
}
