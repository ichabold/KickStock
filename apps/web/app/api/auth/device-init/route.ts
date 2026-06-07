// POST /api/auth/device-init
// Appelé au premier chargement client pour lier device_id à un cookie HttpOnly signé.
// Body : { deviceId: string }
// Retour : { ok: true }

import { NextRequest, NextResponse } from 'next/server';
import { signDeviceId } from '@/lib/deviceSigning';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE_NAME = 'kickstock_device_sig';
const ONE_YEAR = 365 * 24 * 60 * 60;

export async function POST(req: NextRequest) {
  const { deviceId } = await req.json();

  if (!deviceId || !UUID_V4.test(deviceId)) {
    return NextResponse.json({ error: 'invalid_device_id' }, { status: 400 });
  }

  // Si un cookie existe déjà pour ce device, ne pas le réinitialiser.
  // Protège contre une tentative de "réenregistrer" un device_id volé.
  const existing = req.cookies.get(COOKIE_NAME)?.value;
  if (existing) {
    return NextResponse.json({ ok: true, reused: true });
  }

  const signature = await signDeviceId(deviceId);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, signature, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: ONE_YEAR,
  });
  return res;
}
