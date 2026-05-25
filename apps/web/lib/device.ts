/**
 * Persistent anonymous device identifier stored in localStorage.
 * Used to identify a player without requiring authentication.
 * Per the spec: the device_id is the only thing stored in localStorage.
 */
const KEY = 'kickstock_device_id';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
