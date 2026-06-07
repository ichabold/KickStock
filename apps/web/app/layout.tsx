import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { DeviceInit } from '@/components/shared/DeviceInit';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'KickStock — FIFA World Cup 2026',
  description: 'Trade national teams like stocks during the FIFA World Cup 2026',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0A0A0A',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reads locale from getRequestConfig (which reads X-NEXT-INTL-LOCALE set by middleware).
  // Single source of truth — no independent cookie read.
  const locale   = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <DeviceInit />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
