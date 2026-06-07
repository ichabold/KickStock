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
// Fix (option B stricte, telle que recommandée par l'équipe sécurité) :
// verrouiller le device_id au tout premier signataire, sans exception, via la
// table `device_bindings` (migration 018). Toute tentative ultérieure de
// signature pour ce device_id SANS le cookie de signature correspondant est
// rejetée avec 409 device_already_bound — quels que soient le réseau ou le
// navigateur de l'appelant.
//
// ⚠️ Historique : une première version comparait des empreintes hashées
// (IP + User-Agent) et n'imposait le verrou que si les DEUX différaient
// radicalement, dans l'idée de tolérer un propriétaire légitime ayant perdu
// son cookie. Cette logique s'est révélée CONTOURNABLE EN PRODUCTION : sur
// Vercel, `x-forwarded-for` reflète l'IP réelle du client (non falsifiable
// par le client), donc tout attaquant partageant le même réseau que sa
// victime — foyer, entreprise, Wi-Fi public, CGNAT mobile — passait toujours
// le test "même réseau", rendant le verrou inopérant. D'où le retour à la
// règle stricte "premier arrivé, premier servi" sans heuristique de secours.
// Les empreintes restent enregistrées (hashées — jamais l'IP en clair) à des
// fins d'investigation/alerting, mais n'influencent plus la décision.
//
// Effet de bord assumé (validé par l'équipe sécurité comme acceptable) : un
// utilisateur légitime qui viderait ses cookies SANS vider son localStorage
// (cas rare — la plupart des actions "effacer les données" suppriment les
// deux ensemble) recevra un 409 à sa prochaine init. Le client (lib/device.ts)
// se rétablit alors automatiquement en générant un nouveau device_id et en
// relançant l'initialisation — il perd son ancien identifiant local (et le
// portefeuille associé en mode invité) mais reste fonctionnel. Un attaquant ne
// peut pas exploiter cette voie de secours : régénérer un device_id ne lui
// donne accès qu'à un portefeuille neuf, jamais à celui de la victime visée.

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
  // Règle stricte, sans exception heuristique (cf. note d'historique ci-dessus) :
  // toute requête sans cookie pour un device_id déjà lié est un attaquant
  // potentiel — y compris s'il partage le réseau ou le navigateur du
  // propriétaire d'origine.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ua = req.headers.get('user-agent') ?? 'unknown';

  try {
    const admin = createAdminClient();

    const { data: binding } = await adm(admin)
      .from('device_bindings')
      .select('device_id')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (binding) {
      // Alerte de sécurité — une tentative de resignature d'un device_id déjà
      // lié, sans cookie correspondant, est un signal fort de tentative
      // d'usurpation (ou, plus rarement, un utilisateur légitime ayant perdu
      // son cookie). À surveiller dans Sentry sous le tag `device_already_bound`.
      captureApiException(
        new Error('device_already_bound: tentative de resignature sans cookie correspondant'),
        { route: 'POST /api/auth/device-init', extra: { stage: 'binding-reject', deviceId } },
      );
      return NextResponse.json(
        { error: 'device_already_bound', code: 'DEVICE_ALREADY_BOUND' },
        { status: 409 },
      );
    }

    const [ipHash, uaHash] = await Promise.all([hashFingerprint(ip), hashFingerprint(ua)]);
    await adm(admin).from('device_bindings').insert({
      device_id: deviceId,
      first_ip_hash: ipHash,
      first_ua_hash: uaHash,
    });
  } catch (err) {
    // Ne jamais bloquer la signature pour une erreur d'infrastructure du
    // verrou (table absente en local, panne ponctuelle…) — on dégrade vers le
    // comportement pré-ticket plutôt que de casser le jeu pour tout le monde.
    // ⚠️ Ce chemin doit rester exceptionnel : une dégradation prolongée
    // signifierait que le verrou est silencieusement inactif (cf. note
    // historique). Surveiller le tag `binding-check` dans Sentry.
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
