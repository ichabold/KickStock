'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const SUPPORTED = ['en', 'fr'] as const;
type Locale = (typeof SUPPORTED)[number];

/**
 * Server Action — sets the NEXT_LOCALE cookie server-side and redirects back
 * to the same page. Using a Server Action guarantees the cookie is written in
 * the HTTP response headers, bypassing any client-side or App Router cache.
 */
export async function setLocaleCookie(locale: string, pathname: string) {
  const safe: Locale = SUPPORTED.includes(locale as Locale) ? (locale as Locale) : 'en';

  const cookieStore = await cookies();
  cookieStore.set('NEXT_LOCALE', safe, {
    path:    '/',
    maxAge:  60 * 60 * 24 * 365, // 1 year
    sameSite: 'lax',
    // No `secure` flag — works on both HTTP (dev) and HTTPS (prod)
  });

  redirect(pathname);
}
