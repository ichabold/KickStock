'use client';

import { useEffect } from 'react';
import type { MechanicsContract } from '@kickstock/types';
import { REQUIRED_MECHANICS } from '@kickstock/types';

/**
 * PATTERN 3 — MechanicsContract compile-time + runtime validation.
 *
 * Call this hook at the top of each shell (MobileShell, BrowserShell) to
 * verify at dev time that the shell implements all required game mechanics.
 *
 * In production: no-op (zero cost).
 * In development: logs a console warning for any missing mechanic.
 *
 * Usage:
 *   useValidateMechanics({
 *     canViewNationPrice: true,
 *     canBuy: true,
 *     // ... all fields
 *   }, 'MobileShell');
 *
 * If a field is missing or false, a warning is printed with the shell name
 * and the list of missing mechanics.
 */
export function useValidateMechanics(
  provided: MechanicsContract,
  shellName: 'MobileShell' | 'BrowserShell',
): void {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    const missing = (Object.keys(REQUIRED_MECHANICS) as (keyof MechanicsContract)[])
      .filter(key => !provided[key]);

    if (missing.length > 0) {
      console.warn(
        `[KickStock] ⚠️  Shell "${shellName}" is missing required mechanics:\n` +
        missing.map(k => `  • ${k}`).join('\n') + '\n' +
        `Every shell must implement all mechanics to guarantee cross-platform play.`,
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional: validate once at mount
}
