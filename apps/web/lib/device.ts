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
    await fetch('/api/auth/device-init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
      credentials: 'include',
    });
    sessionStorage.setItem(INIT_FLAG, '1');
  } catch {
    // Silencieux — la prochaine requête API retournera 401 et déclenchera un retry
  }
}
