// Vérifie que le X-Device-ID header correspond au cookie HttpOnly signé.
// Retourne null si OK, ou une NextResponse d'erreur si la vérification échoue.

import { NextRequest, NextResponse } from 'next/server';
import { verifyDeviceSignature } from '@/lib/deviceSigning';

const COOKIE_NAME = 'kickstock_device_sig';

export async function verifyDevice(
  req: NextRequest,
  deviceId: string | null,
): Promise<NextResponse | null> {
  if (!process.env.DEVICE_SIGNING_SECRET) return null;
  if (!deviceId) return null;

  const sig = req.cookies.get(COOKIE_NAME)?.value;
  if (!sig) {
    return NextResponse.json(
      { error: 'device_not_initialized', code: 'DEVICE_NOT_INIT' },
      { status: 401 },
    );
  }

  const valid = await verifyDeviceSignature(deviceId, sig);
  if (!valid) {
    return NextResponse.json(
      { error: 'device_signature_mismatch', code: 'DEVICE_MISMATCH' },
      { status: 403 },
    );
  }

  return null;
}
