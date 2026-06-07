const KEY = 'kickstock_device_id';
const INIT_FLAG = 'kickstock_device_initialized';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

// À appeler une fois au démarrage de l'app (dans le root layout ou un hook d'init).
// Si le cookie de signature n'existe pas encore pour ce device, l'enregistre.
export async function initDeviceBinding(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (sessionStorage.getItem(INIT_FLAG)) return;

  const deviceId = getDeviceId();
  try {
    const res = await fetch('/api/auth/device-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
      credentials: 'include',
    });

    if (res.status === 409) {
      // Verrou anti-usurpation (cf. ticket sécurité "device-init binding") :
      // ce device_id est déjà lié à un autre navigateur/réseau. Cas extrêmement
      // rare pour un utilisateur légitime (implique d'avoir vidé ses cookies
      // sans vider son localStorage) — on régénère un identifiant local pour
      // ne pas rester bloqué, et on relance l'init une seule fois avec celui-ci.
      // Remarque : un attaquant ne peut pas exploiter cette voie de secours —
      // régénérer un device_id ne lui donne accès qu'à un portefeuille neuf,
      // pas à celui de la victime qu'il visait.
      localStorage.removeItem(KEY);
      const freshId = getDeviceId();
      await fetch('/api/auth/device-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: freshId }),
        credentials: 'include',
      });
    }

    sessionStorage.setItem(INIT_FLAG, '1');
  } catch {
    // Silencieux — la prochaine requête API retournera 401 et déclenchera un retry
  }
}
