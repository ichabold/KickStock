// POST /api/auth/device-init
// Appelé au premier chargement client pour lier device_id à un cookie HttpOnly signé.
// Body : { deviceId: string }
// Retour : { ok: true } | { ok: true, reused: true } | 409 device_already_bound
//
// ── Anti-usurpation (Plan d'action sécurité, ticket "device-init binding") ──
// Avant ce fix, la route signait n'importe quel device_id v4 fourni par le
// client sans vérifier qu'il appartenait légitimement à l'appelant : un
// attaquant ayant observé le device_id d'une victime pouvait obtenir un
// cookie HttpOnly signé valide pour ce device_id depuis un navigateur vierge,
// puis usurper son identité sur /api/trade, /api/game/state, etc.
//
// Fix (option B recommandée par l'équipe sécurité) : verrouiller le device_id
// au premier signataire via la table `device_bindings` (migration 018), qui
// mémorise une empreinte hashée — JAMAIS l'IP en clair — du réseau et du
// navigateur ayant initié la première signature. Une nouvelle tentative pour
// ce device_id depuis une empreinte radicalement différente (réseau ET
// navigateur à la fois) est rejetée avec 409 device_already_bound. Le
// propriétaire légitime qui a simplement vidé ses cookies présentera très
// généralement au moins un des deux indices (même réseau domestique, même
// navigateur/OS) — ce qui limite fortement les faux positifs.

import { NextRequest, NextResponse } from 'next/server';
import { signDeviceId, hashFingerprint } from '@/lib/deviceSigning';
import { createAdminClient } from '@/lib/supabase/admin';
import { captureApiException } from '@/lib/sentryCapture';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE_NAME = 'kickstock_device_sig';
const ONE_YEAR = 365 * 24 * 60 * 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adm = (admin: ReturnType<typeof createAdminClient>) => (admin as any);

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

  // ── Verrou anti-usurpation : le device_id appartient au premier signataire ──
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ua = req.headers.get('user-agent') ?? 'unknown';

  try {
    const [ipHash, uaHash] = await Promise.all([hashFingerprint(ip), hashFingerprint(ua)]);
    const admin = createAdminClient();

    const { data: binding } = await adm(admin)
      .from('device_bindings')
      .select('first_ip_hash, first_ua_hash')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (binding) {
      const sameNetwork = binding.first_ip_hash === ipHash;
      const sameBrowser = binding.first_ua_hash === uaHash;

      if (!sameNetwork && !sameBrowser) {
        // Empreinte radicalement différente sur les deux axes : très
        // probablement une tentative d'usurpation depuis un appareil distinct.
        return NextResponse.json(
          { error: 'device_already_bound', code: 'DEVICE_ALREADY_BOUND' },
          { status: 409 },
        );
      }

      // Propriétaire légitime probable (a simplement perdu son cookie) —
      // on rafraîchit la dernière empreinte vue et on poursuit normalement.
      await adm(admin)
        .from('device_bindings')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('device_id', deviceId);
    } else {
      await adm(admin).from('device_bindings').insert({
        device_id: deviceId,
        first_ip_hash: ipHash,
        first_ua_hash: uaHash,
      });
    }
  } catch (err) {
    // Ne jamais bloquer la signature pour une erreur d'infrastructure du
    // verrou (table absente en local, panne ponctuelle…) — on dégrade vers le
    // comportement pré-ticket plutôt que de casser le jeu pour tout le monde.
    captureApiException(err, {
      route: 'POST /api/auth/device-init',
      extra: { stage: 'binding-check' },
    });
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
