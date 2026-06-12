import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — KickStock',
  description: 'Terms of Service for KickStock',
};

export default function TermsPage() {
  return (
    <div style={styles.bg}>
      <div style={styles.card}>
        <div style={styles.logoRow}>
          <span style={styles.logoIcon}>⚽</span>
          <span style={styles.logoText}>KICKSTOCK</span>
        </div>

        <h1 style={styles.title}>Terms of Service</h1>
        <p style={styles.updated}>Last updated: June 12, 2026</p>

        <p style={styles.p}>
          These Terms of Service (&quot;Terms&quot;) govern your access to and use of KickStock (the
          &quot;Service&quot;), a fantasy stock-market style game based on the FIFA World Cup 2026. By
          accessing or using the Service, you agree to be bound by these Terms.
        </p>

        <h2 style={styles.h2}>1. Description of the Service</h2>
        <p style={styles.p}>
          KickStock is an entertainment and game application in which users trade virtual shares
          of national football teams using a fictional in-game currency. The Service is for
          entertainment purposes only.
        </p>

        <h2 style={styles.h2}>2. No Real-World Value</h2>
        <p style={styles.p}>
          All currency, shares, scores, and assets within KickStock are entirely virtual and have
          no real-world monetary value. They cannot be exchanged for real money, goods, services,
          or any other item of value, whether inside or outside the Service. KickStock does not
          constitute gambling or betting.
        </p>

        <h2 style={styles.h2}>3. Eligibility and Accounts</h2>
        <ul style={styles.ul}>
          <li>You must be at least 13 years old to use the Service.</li>
          <li>You may create an account via Google sign-in, email, or as a guest.</li>
          <li>You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account.</li>
          <li>You agree to provide accurate information when creating an account.</li>
        </ul>

        <h2 style={styles.h2}>4. Acceptable Use</h2>
        <p style={styles.p}>You agree not to:</p>
        <ul style={styles.ul}>
          <li>Use bots, scripts, or automated tools to interact with the Service.</li>
          <li>Exploit bugs, glitches, or vulnerabilities for unfair advantage.</li>
          <li>Attempt to gain unauthorized access to other accounts or to our systems.</li>
          <li>Use the Service for any unlawful, abusive, or fraudulent purpose.</li>
          <li>Create multiple accounts to manipulate leaderboards or competitions.</li>
        </ul>

        <h2 style={styles.h2}>5. Intellectual Property</h2>
        <p style={styles.p}>
          The Service, including its design, software, graphics, and branding, is owned by
          KickStock and protected by applicable intellectual property laws. Team names and
          competition data are used for informational/entertainment purposes and remain the
          property of their respective owners. KickStock is not affiliated with or endorsed by
          FIFA or any national football association.
        </p>

        <h2 style={styles.h2}>6. Service Availability</h2>
        <p style={styles.p}>
          The Service is provided on an &quot;as is&quot; and &quot;as available&quot; basis. We may modify, suspend,
          or discontinue all or part of the Service at any time, including resetting game data
          between seasons or competitions, without prior notice.
        </p>

        <h2 style={styles.h2}>7. Disclaimer of Warranties &amp; Limitation of Liability</h2>
        <p style={styles.p}>
          To the maximum extent permitted by law, KickStock is provided without warranties of any
          kind, express or implied. We are not liable for any indirect, incidental, or
          consequential damages arising from your use of, or inability to use, the Service.
        </p>

        <h2 style={styles.h2}>8. Termination</h2>
        <p style={styles.p}>
          We may suspend or terminate your access to the Service at any time, including for
          violation of these Terms, without notice. You may stop using the Service and request
          deletion of your account at any time.
        </p>

        <h2 style={styles.h2}>9. Changes to These Terms</h2>
        <p style={styles.p}>
          We may update these Terms from time to time. Continued use of the Service after changes
          take effect constitutes acceptance of the revised Terms.
        </p>

        <h2 style={styles.h2}>10. Contact</h2>
        <p style={styles.p}>
          For any questions about these Terms, contact us at{' '}
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
