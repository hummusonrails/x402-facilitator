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
    const { address, approved, rejectionReason } = await request.json();

    if (!address || approved === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const adminUsername = process.env.ADMIN_USERNAME || 'admin';

    if (approved) {
      // Approve merchant
      const result = await pool.query(
        `UPDATE merchants
         SET approved = true,
             enabled = true,
             approved_at = NOW(),
             approved_by = $1,
             rejection_reason = NULL
         WHERE LOWER(address) = LOWER($2)
         AND approved = false`,
        [adminUsername, address]
      );

      if (result.rowCount === 0) {
        return NextResponse.json({ error: 'Merchant not found or already processed' }, { status: 404 });
      }

      return NextResponse.json({ success: true, message: 'Merchant approved' });
    } else {
      // Reject merchant
      if (!rejectionReason) {
        return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 });
      }

      const result = await pool.query(
        `UPDATE merchants
         SET approved = false,
             enabled = false,
             approved_at = NOW(),
             approved_by = $1,
             rejection_reason = $2
         WHERE LOWER(address) = LOWER($3)`,
        [adminUsername, rejectionReason, address]
      );

      if (result.rowCount === 0) {
        return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, message: 'Merchant rejected' });
    }
  } catch (error: any) {
    console.error('Failed to approve/reject merchant:', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
