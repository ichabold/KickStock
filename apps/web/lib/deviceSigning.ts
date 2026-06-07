// Signature et vérification HMAC-SHA256 du device_id.
// Le secret est une variable d'environnement serveur uniquement.

const SECRET = process.env.DEVICE_SIGNING_SECRET ?? '';

async function hmac(deviceId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(deviceId));
  return Buffer.from(sig).toString('hex');
}

export async function signDeviceId(deviceId: string): Promise<string> {
  return hmac(deviceId);
}

export async function verifyDeviceSignature(
  deviceId: string,
  signature: string,
): Promise<boolean> {
  if (!SECRET) return true;
  const expected = await hmac(deviceId);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
