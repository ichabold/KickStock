'use client';

import { useEffect } from 'react';
import { initDeviceBinding } from '@/lib/device';

export function DeviceInit() {
  useEffect(() => {
    initDeviceBinding();
  }, []);

  return null;
}
