import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const SUPPORTED_LOCALES = ['en', 'fr'] as const;
const LOCALE_COOKIE = 'NEXT_LOCALE';
const LOCALE_HEADER = 'X-NEXT-INTL-LOCALE'; // consumed by next-intl v4 getRequestLocale()
const LOCALE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function detectLocale(request: NextRequest): string {
  const acceptLang = request.headers.get('accept-language') ?? '';
  // Match 'fr', 'fr-FR', 'fr-CA', etc.
  const primary = acceptLang.split(',')[0]?.split('-')[0]?.toLowerCase() ?? '';
  return SUPPORTED_LOCALES.includes(primary as (typeof SUPPORTED_LOCALES)[number])
    ? primary
    : 'en';
}

/**
 * Resolves the current locale: cookie wins, then Accept-Language, then 'en'.
 * If no cookie exists yet, also sets it on the response.
 */
function resolveAndApplyLocale(
  response: NextResponse,
  request: NextRequest,
): { response: NextResponse; locale: string } {
  // /api/set-locale sets its own cookie — don't interfere
  if (request.nextUrl.pathname === '/api/set-locale') {
    const existing = request.cookies.get(LOCALE_COOKIE)?.value ?? detectLocale(request);
    return { response, locale: existing };
  }

  const existing = request.cookies.get(LOCALE_COOKIE)?.value;
  if (existing) return { response, locale: existing };

  // First visit: detect from Accept-Language and persist in cookie
  const locale = detectLocale(request);
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_MAX_AGE,
    sameSite: 'lax',
  });
  return { response, locale };
}

export async function middleware(request: NextRequest) {
  // Inject X-NEXT-INTL-LOCALE header so next-intl v4 getRequestLocale() works
  // without needing to re-read the cookie inside getRequestConfig.
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = SUPPORTED_LOCALES.includes(cookieLocale as (typeof SUPPORTED_LOCALES)[number])
    ? cookieLocale!
    : detectLocale(request);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_HEADER, locale);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          // Re-snapshot request.headers AFTER cookie mutations so server components
          // on this request can read the fresh Supabase session token.
          const updatedHeaders = new Headers(request.headers);
          updatedHeaders.set(LOCALE_HEADER, locale);
          supabaseResponse = NextResponse.next({ request: { headers: updatedHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session — do not remove this line
  const { data: { user } } = await supabase.auth.getUser();

  // Redirect logged-in users away from auth pages
  if (user && (
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/register')
  )) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    const { response: withCookie } = resolveAndApplyLocale(NextResponse.redirect(url), request);
    return withCookie;
  }

  // Protect /admin — must be authenticated and have role=admin in app_metadata
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      const { response: withCookie } = resolveAndApplyLocale(NextResponse.redirect(url), request);
      return withCookie;
    }
    const isAdmin = user.app_metadata?.role === 'admin';
    if (!isAdmin) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  const { response: final } = resolveAndApplyLocale(supabaseResponse, request);
  return final;
}

export const config = {
  matcher: [
    // /auth/callback and /auth/confirm are excluded: middleware must NOT touch
    // PKCE/OTP cookies before the route handlers can verify them.
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|auth/confirm|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
