import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  console.log('Login attempt received');
  const { username, password } = await request.json();
  console.log('Username:', username);

  const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  console.log('Env ADMIN_USERNAME:', ADMIN_USERNAME ? 'set' : 'NOT SET');
  console.log('Env ADMIN_PASSWORD:', ADMIN_PASSWORD ? 'set' : 'NOT SET');

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.error('Admin credentials not configured in .env file');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    console.log('Login successful');
    const cookieStore = await cookies();
    cookieStore.set('admin-session', 'authenticated', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });

    return NextResponse.json({ success: true });
  }

  console.log('Login failed - invalid credentials');
  return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
}
