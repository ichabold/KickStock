/**
 * GET /api/set-locale?locale=en&redirect=/
 *
 * Sets the NEXT_LOCALE cookie via an HTTP redirect response.
 * This is the most reliable locale-switch mechanism for Next.js App Router:
 *   1. Browser navigates to this route (window.location.href)
 *   2. Route sets Set-Cookie: NEXT_LOCALE=<locale> in the response headers
 *   3. Route redirects (HTTP 302) back to the original page
 *   4. Browser follows redirect — root layout re-executes with the new cookie
 *
 * Bypasses Next.js Router Cache entirely (it's a real HTTP redirect, not
 * a client-side navigation).
 */
import { NextRequest, NextResponse } from 'next/server';

const SUPPORTED = ['en', 'fr'] as const;
type Locale = (typeof SUPPORTED)[number];

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const locale   = req.nextUrl.searchParams.get('locale') ?? 'en';
  const redirect = req.nextUrl.searchParams.get('redirect') ?? '/';

  const safe: Locale = SUPPORTED.includes(locale as Locale)
    ? (locale as Locale)
    : 'en';

  // Validate redirect target — only allow relative paths (no open redirect)
  const safePath = redirect.startsWith('/') ? redirect : '/';

  const response = NextResponse.redirect(new URL(safePath, req.url));
  response.cookies.set('NEXT_LOCALE', safe, {
    path:     '/',
    maxAge:   60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  return response;
}
