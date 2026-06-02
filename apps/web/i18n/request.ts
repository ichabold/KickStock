import { getRequestConfig } from 'next-intl/server';
import { resolveLocale }    from '@kickstock/i18n';

/**
 * next-intl v4: locale comes from `requestLocale` which resolves to the
 * X-NEXT-INTL-LOCALE header injected by middleware.ts.
 * No need to re-read cookies here — middleware is the single source of truth.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const locale = resolveLocale(await requestLocale);

  const messages = locale === 'fr'
    ? (await import('@kickstock/i18n/locales/fr.json')).default
    : (await import('@kickstock/i18n/locales/en.json')).default;

  return { locale, messages };
});
