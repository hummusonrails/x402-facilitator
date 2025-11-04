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
    const { address, name, apiKeyHash } = await request.json();

    if (!address || !name || !apiKeyHash) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await pool.query(
      `INSERT INTO merchants (address, name, api_key_hash)
       VALUES ($1, $2, $3)`,
      [address, name, apiKeyHash]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to add merchant:', error);
    
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Merchant address already exists' }, { status: 400 });
    }
    
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
