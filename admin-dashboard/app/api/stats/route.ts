import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getStats } from '@/utils/db';

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin-session');

  if (session?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await getStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
