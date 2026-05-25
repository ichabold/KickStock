import { NextResponse } from 'next/server';
import { NATIONS } from '@kickstock/constants';

/**
 * GET /api/market
 * Phase 1: returns initial prices from constants
 * Phase 2: returns live prices from Redis cache / Supabase
 */
export async function GET() {
  const prices = Object.fromEntries(NATIONS.map(n => [n.id, n.p]));
  return NextResponse.json({ prices, updatedAt: new Date().toISOString() });
}
