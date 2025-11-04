import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function POST(request: Request) {
  try {
    const { address, name, email, description } = await request.json();

    // Validate inputs
    if (!address || !name || !email || !description) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    // Validate Ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid Ethereum address' }, { status: 400 });
    }

    // Check if address already registered
    const existing = await pool.query(
      'SELECT address FROM merchants WHERE LOWER(address) = LOWER($1)',
      [address]
    );

    if (existing.rows.length > 0) {
      return NextResponse.json({ 
        error: 'This address is already registered. Please contact support if you need assistance.' 
      }, { status: 400 });
    }

    // Generate API key
    const apiKey = randomBytes(32).toString('hex');
    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    await pool.query(
      `INSERT INTO merchants (
        address, name, api_key_hash, enabled, approved, 
        rate_limit, requested_at, email, description
      ) VALUES ($1, $2, $3, false, false, 50, NOW(), $4, $5)`,
      [address, name, apiKeyHash, email, description]
    );

    return NextResponse.json({
      success: true,
      apiKey, // Return once, never shown again
      message: 'Registration submitted. You will be notified when approved.',
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Address already registered' }, { status: 400 });
    }
    
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
