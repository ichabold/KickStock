import { getRequestConfig } from 'next-intl/server';
import { cookies }          from 'next/headers';
import { resolveLocale }    from '@kickstock/i18n';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale      = resolveLocale(cookieStore.get('NEXT_LOCALE')?.value);

  const messages = locale === 'fr'
    ? (await import('@kickstock/i18n/locales/fr.json')).default
    : (await import('@kickstock/i18n/locales/en.json')).default;

  return { locale, messages };
});
