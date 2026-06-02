import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const SUPPORTED_LOCALES = ['en', 'fr'] as const;
const LOCALE_COOKIE = 'NEXT_LOCALE';
const LOCALE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function detectLocale(request: NextRequest): string {
  const acceptLang = request.headers.get('accept-language') ?? '';
  // Match 'fr', 'fr-FR', 'fr-CA', etc.
  const primary = acceptLang.split(',')[0]?.split('-')[0]?.toLowerCase() ?? '';
  return SUPPORTED_LOCALES.includes(primary as (typeof SUPPORTED_LOCALES)[number])
    ? primary
    : 'en';
}

function applyLocaleCookie(response: NextResponse, request: NextRequest): NextResponse {
  if (request.cookies.get(LOCALE_COOKIE)) return response;
  const locale = detectLocale(request);
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_MAX_AGE,
    sameSite: 'lax',
  });
  return response;
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

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
          supabaseResponse = NextResponse.next({ request });
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
    return applyLocaleCookie(NextResponse.redirect(url), request);
  }

  // Protect /admin — must be authenticated and have role=admin in app_metadata
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return applyLocaleCookie(NextResponse.redirect(url), request);
    }
    const isAdmin = user.app_metadata?.role === 'admin';
    if (!isAdmin) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  return applyLocaleCookie(supabaseResponse, request);
}

export const config = {
  matcher: [
    // /auth/callback and /auth/confirm are excluded: middleware must NOT touch
    // PKCE/OTP cookies before the route handlers can verify them.
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|auth/confirm|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
