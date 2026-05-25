'use client';

import { useState, useEffect } from 'react';
import { MOBILE_BREAKPOINT } from '@kickstock/constants';
import type { LayoutType } from '@kickstock/types';

export function useLayout(): LayoutType {
  const [layout, setLayout] = useState<LayoutType>('browser');

  useEffect(() => {
    const check = () => {
      setLayout(window.innerWidth < MOBILE_BREAKPOINT ? 'mobile' : 'browser');
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return layout;
}
