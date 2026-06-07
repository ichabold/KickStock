// @ts-check
const { withSentryConfig } = require('@sentry/nextjs');
const withNextIntl          = require('next-intl/plugin')('./i18n/request.ts');

// Headers de sécurité applicatifs — Plan d'action sécurité, ticket "headers HTTP manquants".
// Calibrés pour les intégrations actuelles : Supabase (auth/RPC/realtime), Sentry
// (erreurs + replay), Cloudflare Turnstile (captcha invisible sur /api/auth/guest),
// Google OAuth (redirection Supabase → accounts.google.com), Google Fonts
// (@import dans styles/globals.css → fonts.googleapis.com / fonts.gstatic.com).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://*.sentry.io",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io https://challenges.cloudflare.com https://api-football-v1.p.rapidapi.com",
  "frame-src https://challenges.cloudflare.com https://accounts.google.com https://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'X-Frame-Options',        value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',     value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy', value: CSP },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false, // supprime le header `x-powered-by: Next.js` (fingerprinting gratuit)

  transpilePackages: [
    '@kickstock/types',
    '@kickstock/constants',
    '@kickstock/game-engine',
    '@kickstock/i18n',
  ],
  eslint: {
    ignoreDuringBuilds: true,   // ESLint not installed as build dep — lint locally
  },
  typescript: {
    ignoreBuildErrors: false,   // keep TS errors fatal
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

module.exports = withSentryConfig(withNextIntl(nextConfig), {
  // Sentry organisation + project (set via CI env vars or .sentryclirc)
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Upload source maps only in CI (avoids local noise)
  silent:            !process.env.CI,
  hideSourceMaps:    true,
  disableLogger:     true,

  // Don't block builds if Sentry upload fails (no DSN in dev)
  errorHandler: (err) => { console.warn('[sentry] build warning:', err.message); },

  // Sentry 10.x autoInstrumentMiddleware is broken with Next.js 14 (ESM package.json resolution bug)
  webpack: { autoInstrumentMiddleware: false },
});
