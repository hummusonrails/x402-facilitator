import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

export async function POST() {
  const cookieStore = await cookies();
  const session = cookieStore.get('admin-session');

  if (session?.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Generate random 64-character hex API key
    const apiKey = randomBytes(32).toString('hex');
    
    // Hash it with bcrypt
    const hash = await bcrypt.hash(apiKey, 10);

    return NextResponse.json({
      apiKey,
      hash,
    });
  } catch (error: any) {
    console.error('Failed to generate API key:', error);
    return NextResponse.json({ error: 'Failed to generate key' }, { status: 500 });
  }
}
