import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin-session');

  if (session?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { address, enabled } = await request.json();

    if (!address || enabled === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const result = await pool.query(
      `UPDATE merchants
       SET enabled = $1
       WHERE LOWER(address) = LOWER($2)`,
      [enabled, address]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to toggle merchant:', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
