// @ts-check
const { withSentryConfig } = require('@sentry/nextjs');
const withNextIntl          = require('next-intl/plugin')('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
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
