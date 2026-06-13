'use client';

import { useTranslations } from 'next-intl';
import RankingPanel from './RankingPanel';
import styles from './RankingOverlay.module.css';

interface Props {
  onClose: () => void;
}

export default function RankingOverlay({ onClose }: Props) {
  const ts = useTranslations('shell');
  const tc = useTranslations('common');

  return (
    <div className={styles.bg} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.sheet} onClick={e => e.stopPropagation()}>
        <div className={styles.topBar}>
          <div className={styles.title}>🏆 {ts('rankingTitle')}</div>
          <button className={styles.closeBtn} onClick={onClose} aria-label={tc('back')}>✕</button>
        </div>
        <RankingPanel />
      </div>
    </div>
  );
}
