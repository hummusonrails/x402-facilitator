import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin-session');

  if (session?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await pool.query(
      `SELECT address, name, enabled, approved, rate_limit, created_at, requested_at, email, description
       FROM merchants
       ORDER BY 
         CASE WHEN approved = false THEN 0 ELSE 1 END,
         created_at DESC`
    );

    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error('Failed to fetch merchants:', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
