import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'KickStock — FIFA World Cup 2026',
  description: 'Trade national teams like stocks during the FIFA World Cup 2026',
  manifest: '/manifest.json',
  themeColor: '#0A0A0A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
