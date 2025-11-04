import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin-session');

  if (session?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { nonce, reason } = await request.json();

  try {
    const facilitatorUrl = process.env.FACILITATOR_API_URL || 'http://localhost:3002';
    const adminKey = process.env.FACILITATOR_ADMIN_KEY;

    const response = await fetch(`${facilitatorUrl}/admin/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminKey || '',
      },
      body: JSON.stringify({ nonce, reason }),
    });

    const data = await response.json();

    if (response.ok) {
      return NextResponse.json(data);
    } else {
      return NextResponse.json(data, { status: response.status });
    }
  } catch (error) {
    console.error('Refund request failed:', error);
    return NextResponse.json({ error: 'Refund request failed' }, { status: 500 });
  }
}
