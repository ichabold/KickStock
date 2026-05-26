const KEY = 'kickstock_pseudo';

export function getPseudo(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
}

export function setPseudo(p: string): void {
  localStorage.setItem(KEY, p);
}

export function clearPseudo(): void {
  localStorage.removeItem(KEY);
}

export function isValidPseudoFormat(p: string): boolean {
  if (p.length < 3 || p.length > 20) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(p)) return false;
  if (/^[_-]|[_-]$/.test(p)) return false;
  return true;
}
