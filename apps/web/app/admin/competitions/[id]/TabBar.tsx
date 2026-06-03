'use client';

import { useRouter, usePathname } from 'next/navigation';

export type TabId = 'info' | 'format' | 'teams' | 'matches';

const TABS: { id: TabId; label: string }[] = [
  { id: 'info',    label: 'Info'     },
  { id: 'format',  label: 'Format'   },
  { id: 'teams',   label: 'Équipes'  },
  { id: 'matches', label: 'Matches'  },
];

export default function TabBar({ active }: { active: TabId }) {
  const router   = useRouter();
  const pathname = usePathname();

  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #222', marginBottom: 28 }}>
      {TABS.map(t => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => router.push(`${pathname}?tab=${t.id}`)}
            style={{
              padding: '10px 20px',
              background:   'transparent',
              border:       'none',
              borderBottom: isActive ? '2px solid #FFDB00' : '2px solid transparent',
              color:        isActive ? '#FFDB00' : '#555',
              cursor:       'pointer',
              fontSize:     12,
              fontFamily:   'monospace',
              fontWeight:   isActive ? 700 : 400,
              letterSpacing: 1,
              marginBottom: -1,
            }}
          >
            {t.label.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
