import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — KickStock',
  description: 'Privacy Policy for KickStock',
};

export default function PrivacyPage() {
  return (
    <div style={styles.bg}>
      <div style={styles.card}>
        <div style={styles.logoRow}>
          <span style={styles.logoIcon}>⚽</span>
          <span style={styles.logoText}>KICKSTOCK</span>
        </div>

        <h1 style={styles.title}>Privacy Policy</h1>
        <p style={styles.updated}>Last updated: June 12, 2026</p>

        <p style={styles.p}>
          This Privacy Policy explains how KickStock (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) collects, uses,
          and protects information when you use the KickStock application (the &quot;Service&quot;), a
          fantasy stock-market style game based on the FIFA World Cup 2026.
        </p>

        <h2 style={styles.h2}>1. Information We Collect</h2>
        <ul style={styles.ul}>
          <li><strong>Account information:</strong> when you sign in with Google, we receive your name, email address, and profile picture from your Google account. If you sign up with email, we collect your email address and a chosen username (pseudo).</li>
          <li><strong>Guest accounts:</strong> if you play as a guest, we generate an anonymous device identifier to keep track of your game progress.</li>
          <li><strong>Gameplay data:</strong> your portfolio, trades, virtual currency balance, competition entries, and related in-game activity.</li>
          <li><strong>Technical data:</strong> IP address, browser type, device information, and error/crash diagnostics collected automatically through our hosting and monitoring providers.</li>
        </ul>

        <h2 style={styles.h2}>2. How We Use Your Information</h2>
        <ul style={styles.ul}>
          <li>To create and manage your account and game progress.</li>
          <li>To operate gameplay features such as trading, leaderboards, and competitions.</li>
          <li>To secure the Service, prevent abuse, and detect fraudulent activity.</li>
          <li>To diagnose bugs and improve the Service through error monitoring.</li>
          <li>To communicate with you about your account when necessary.</li>
        </ul>

        <h2 style={styles.h2}>3. Third-Party Services</h2>
        <p style={styles.p}>We rely on the following third-party providers to operate KickStock:</p>
        <ul style={styles.ul}>
          <li><strong>Supabase</strong> — authentication, database, and storage of your account and gameplay data.</li>
          <li><strong>Google OAuth</strong> — optional sign-in with your Google account.</li>
          <li><strong>Cloudflare Turnstile</strong> — an invisible captcha used to protect guest sign-up from automated abuse.</li>
          <li><strong>Sentry</strong> — error tracking and performance monitoring to help us fix bugs.</li>
          <li><strong>Vercel</strong> — application hosting.</li>
        </ul>
        <p style={styles.p}>
          Each provider processes data under its own privacy policy. We only share the minimum
          information necessary for these services to function.
        </p>

        <h2 style={styles.h2}>4. Cookies</h2>
        <p style={styles.p}>
          We use essential cookies to keep you signed in, remember your language preference, and
          maintain your guest device identifier. We do not use third-party advertising cookies.
        </p>

        <h2 style={styles.h2}>5. Data Retention</h2>
        <p style={styles.p}>
          We retain your account and gameplay data for as long as your account is active. If you
          wish to delete your account and associated data, contact us using the details below.
        </p>

        <h2 style={styles.h2}>6. Your Rights</h2>
        <p style={styles.p}>
          Depending on your location, you may have the right to access, correct, export, or delete
          your personal data, and to object to or restrict certain processing. To exercise these
          rights, contact us at the email address below.
        </p>

        <h2 style={styles.h2}>7. Children&apos;s Privacy</h2>
        <p style={styles.p}>
          KickStock is not directed at children under 13 (or the minimum age required in your
          country to consent to data processing). We do not knowingly collect personal information
          from children below this age.
        </p>

        <h2 style={styles.h2}>8. Changes to This Policy</h2>
        <p style={styles.p}>
          We may update this Privacy Policy from time to time. Material changes will be reflected
          by updating the &quot;Last updated&quot; date above.
        </p>

        <h2 style={styles.h2}>9. Contact</h2>
        <p style={styles.p}>
          For any questions about this Privacy Policy or your data, contact us at{' '}
          <a href="mailto:kickstock.game@gmail.com" style={styles.link}>kickstock.game@gmail.com</a>.
        </p>

        <div style={styles.backRow}>
          <Link href="/login" style={styles.backLink}>← Back to login</Link>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bg: {
    minHeight: '100dvh',
    background: '#0A0A0A',
    display: 'flex',
    justifyContent: 'center',
    padding: '40px 20px',
    fontFamily: "'Inter Tight', sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: 720,
    background: '#111',
    border: '1px solid #1E1E1E',
    borderRadius: 16,
    padding: '32px 28px',
    color: '#ccc',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
    justifyContent: 'center',
  },
  logoIcon: { fontSize: 28 },
  logoText: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 28,
    letterSpacing: 4,
    color: '#FFDB00',
  },
  title: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 28,
    letterSpacing: 3,
    color: '#fff',
    marginBottom: 4,
  },
  updated: {
    fontSize: 11,
    color: '#555',
    marginBottom: 24,
  },
  h2: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 16,
    letterSpacing: 2,
    color: '#FFDB00',
    marginTop: 28,
    marginBottom: 8,
  },
  p: {
    fontSize: 13,
    lineHeight: 1.6,
    color: '#ccc',
    marginBottom: 10,
  },
  ul: {
    fontSize: 13,
    lineHeight: 1.6,
    color: '#ccc',
    paddingLeft: 20,
    marginBottom: 10,
  },
  link: {
    color: '#FFDB00',
    textDecoration: 'underline',
  },
  backRow: {
    marginTop: 32,
    textAlign: 'center',
  },
  backLink: {
    fontSize: 12,
    color: '#666',
    textDecoration: 'none',
    letterSpacing: 1,
  },
};
