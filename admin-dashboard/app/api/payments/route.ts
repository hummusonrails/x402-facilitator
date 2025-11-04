import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getPayments } from '@/utils/db';

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin-session');

  if (session?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payments = await getPayments(50);
    return NextResponse.json(payments);
  } catch (error) {
    console.error('Failed to fetch payments:', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
