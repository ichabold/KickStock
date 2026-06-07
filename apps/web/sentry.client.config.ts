import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,

  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 0.5,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
      unmask: ['.sentry-unmask'],
    }),
  ],

  beforeSend(event) {
    return sanitizeSentryEvent(event);
  },

  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});

function sanitizeSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.request?.cookies) {
    event.request.cookies = {};
  }
  if (event.request?.headers) {
    delete event.request.headers['x-device-id'];
    delete event.request.headers['authorization'];
    delete event.request.headers['cookie'];
  }
  return event;
}
