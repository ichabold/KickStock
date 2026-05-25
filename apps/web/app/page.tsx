'use client';

import { useLayout } from '@/hooks/useLayout';
import MobileShell from '@/components/mobile/MobileShell';
import BrowserShell from '@/components/browser/BrowserShell';

export default function HomePage() {
  const layout = useLayout();
  return layout === 'mobile' ? <MobileShell /> : <BrowserShell />;
}
