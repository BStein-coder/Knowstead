import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, KeyRound, LogIn, MailCheck, UserPlus } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { taglineText } from '../../lib/built-in-texts';
import { Alert, Button, Checkbox, Field, Input, Loading, cx } from '../../components/ui';
import { Scene3D } from '../../components/Scene3D';
import { SSO_ERROR_CODES, SsoButtons } from './SsoButtons';

/**
 * Rahmen aller Seiten vor der Anmeldung: die 3D-Szene als Bühne, links Name und Leitsatz der Installation,
 * rechts die Karte mit dem Formular. Auf schmalen Bildschirmen bleibt die Karte allein in der Mitte.
 */
export function AuthCard({ title, subtitle, children, wide }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  const { settings } = useAuth();
  const { t } = useI18n();
  const tagline = taglineText(settings.siteTagline, t);
  return (
    <div className="auth-page">
      <Scene3D variant="stage" className={wide ? 'is-wide' : undefined} />
      <main className={cx('auth-shell', wide && 'wide')}>
        <div className="auth-intro">
          <span className="brand-logo auth-intro-logo">
            <BookOpen size={22} />
          </span>
          <p className="auth-intro-title">{settings.siteName}</p>
          {tagline && <p className="auth-intro-text">{tagline}</p>}
          {settings.footerText && <p className="auth-intro-foot">{settings.footerText}</p>}
        </div>
        <div className={cx('auth-card', wide && 'wide')}>
          <div className="auth-brand">
            <span className="brand-logo">
              <BookOpen size={20} />
            </span>
            <strong style={{ fontSize: 17 }}>{settings.siteName}</strong>
          </div>
          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * Ziel nach der Anmeldung – nur eigene Pfade. Browser lesen „/\host“ wie „//host“ und entfernen
 * Tabulatoren und Zeilenumbrüche aus Adressen; solche Werte führten zwar nirgends hin (der Router
 * verweigert fremde Ziele), endeten aber in einem Fehlerbildschirm statt auf der Startseite.
 */
function safeNext(next: string | null): string {
  return next && /^\/(?![/\\])[^\\\x00-\x1f]*$/.test(next) ? next : '/';
}

export function LoginPage() {
  const { t } = useI18n();
  const { data, user, settings, loading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLocal, setShowLocal] = useState(params.has('local'));
  const next = safeNext(params.get('next'));
  const ssoError = params.get('sso_error');

  if (loading) return <Loading />;
  if (data?.needsSetup) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={next} replace />;
  const sso = data?.sso ?? { providers: [], showLocalLogin: true, kerberosAuto: false };
  const localVisible = sso.showLocalLogin || showLocal || !sso.providers.length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/auth/login', { login, password, remember });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t('auth.loginTitle', { site: settings.siteName })} subtitle={t('auth.loginSubtitle')}>
      {ssoError && (
        <div className="mb-2">
          <Alert variant="error" title={t('sso.errorTitle')}>
            {t(`sso.errors.${SSO_ERROR_CODES.includes(ssoError) ? ssoError : 'provider'}`)}
          </Alert>
        </div>
      )}
      <SsoButtons sso={sso} next={next} remember={remember} autoStart={!ssoError && !params.has('local')} />
      {sso.providers.length > 0 && localVisible && (
        <div className="auth-divider" role="separator">
          <span>{t('sso.or')}</span>
        </div>
      )}
      {!localVisible && (
        <div className="auth-footer" style={{ marginTop: '0.75rem' }}>
          <button type="button" className="link-like" onClick={() => setShowLocal(true)}>
            {t('sso.showLocalForm')}
          </button>
        </div>
      )}
      {localVisible && (
        <form onSubmit={submit}>
          {error && (
            <div className="mb-2">
              <Alert variant="error">{error}</Alert>
            </div>
          )}
          <Field label={t('auth.usernameOrEmail')}>
            <Input value={login} onChange={(e) => setLogin(e.target.value)} autoFocus autoComplete="username" required />
          </Field>
          <Field label={t('auth.password')}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <div className="row mb-2">
            <Checkbox checked={remember} onChange={setRemember} label={t('auth.remember')} />
            <span className="spacer" />
            <Link to="/forgot-password" className="small">
              {t('auth.forgot')}
            </Link>
          </div>
          <Button type="submit" variant="primary" block size="lg" icon={LogIn} loading={busy}>
            {t('auth.submitLogin')}
          </Button>
        </form>
      )}
      {!localVisible && (
        <div className="row mt-1" style={{ justifyContent: 'center' }}>
          <Checkbox checked={remember} onChange={setRemember} label={t('auth.remember')} />
        </div>
      )}
      <div className="auth-footer">
        {settings.allowRegistration && (
          <div>
            {t('auth.noAccount')} <Link to="/register">{t('auth.register')}</Link>
          </div>
        )}
        {settings.anonymousAccess && (
          <div className="mt-1">
            <Link to="/">{t('auth.anonymousBrowse')}</Link>
          </div>
        )}
      </div>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { t } = useI18n();
  const { settings, data } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '', repeat: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  if (!settings.allowRegistration) return <Navigate to="/login" replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.repeat) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ pending: boolean; email?: string | null }>('/api/v1/auth/register', {
        username: form.username,
        displayName: form.displayName,
        email: form.email,
        password: form.password,
      });
      if (res.pending) {
        setPendingEmail(res.email ?? form.email);
        return;
      }
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (pendingEmail) {
    return (
      <AuthCard title={t('auth.registerTitle')}>
        <Alert variant="success" title={t('auth.registerPendingTitle')}>
          {t('auth.registerPendingText', { email: pendingEmail })}
        </Alert>
        <div className="auth-footer">
          <Link to="/login">{t('auth.toLogin')}</Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.registerTitle')}>
      <form onSubmit={submit}>
        {error && (
          <div className="mb-2">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        <Field label={t('auth.displayName')}>
          <Input value={form.displayName} onChange={set('displayName')} autoFocus required />
        </Field>
        <Field label={t('auth.username')}>
          <Input value={form.username} onChange={set('username')} autoComplete="username" required />
        </Field>
        <Field label={t('auth.email')} help={data?.mailConfigured ? t('auth.registerVerifyHint') : undefined}>
          <Input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </Field>
        <Field label={t('auth.password')} help={t('auth.passwordHint', { n: settings.passwordMinLength })}>
          <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required />
        </Field>
        <Field label={t('auth.passwordRepeat')}>
          <Input type="password" value={form.repeat} onChange={set('repeat')} autoComplete="new-password" required />
        </Field>
        <Button type="submit" variant="primary" block size="lg" icon={UserPlus} loading={busy}>
          {t('auth.register')}
        </Button>
      </form>
      <div className="auth-footer">
        {t('auth.haveAccount')} <Link to="/login">{t('app.login')}</Link>
      </div>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const { data } = useAuth();
  const [login, setLogin] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title={t('auth.forgotTitle')} subtitle={t('auth.forgotText')}>
      {!data?.mailConfigured && (
        <div className="mb-2">
          <Alert variant="warning">{t('auth.forgotNoMail')}</Alert>
        </div>
      )}
      {sent ? (
        <Alert variant="success">{t('auth.forgotSent')}</Alert>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api.post('/api/v1/auth/forgot', { login });
            } finally {
              setBusy(false);
              setSent(true);
            }
          }}
        >
          <Field label={t('auth.usernameOrEmail')}>
            <Input value={login} onChange={(e) => setLogin(e.target.value)} autoFocus required />
          </Field>
          <Button type="submit" variant="primary" block loading={busy} disabled={!data?.mailConfigured}>
            {t('auth.sendLink')}
          </Button>
        </form>
      )}
      <div className="auth-footer">
        <Link to="/login">{t('auth.toLogin')}</Link>
      </div>
    </AuthCard>
  );
}

/**
 * Link aus der Registrierungs-E-Mail. Bestätigt wird erst per Klick – Virenscanner, die Links in
 * E-Mails vorab öffnen, lösen den Link so nicht ein.
 */
export function VerifyEmailPage() {
  const { t } = useI18n();
  const { token } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title={t('auth.verifyTitle')} subtitle={t('auth.verifyText')}>
      {error && (
        <div className="mb-2">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <Button
        variant="primary"
        block
        size="lg"
        icon={MailCheck}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.post('/api/v1/auth/verify-email', { token });
            await qc.invalidateQueries({ queryKey: ['me'] });
            navigate('/', { replace: true });
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('auth.verifySubmit')}
      </Button>
      <div className="auth-footer">
        <Link to="/login">{t('auth.toLogin')}</Link>
      </div>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const { t } = useI18n();
  const { token } = useParams();
  const { settings } = useAuth();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title={t('auth.resetTitle')}>
      {done ? (
        <>
          <Alert variant="success">{t('auth.resetDone')}</Alert>
          <div className="auth-footer">
            <Link to="/login" className="btn btn-primary">
              {t('auth.toLogin')}
            </Link>
          </div>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (password !== repeat) {
              setError(t('auth.passwordMismatch'));
              return;
            }
            setBusy(true);
            setError(null);
            try {
              await api.post('/api/v1/auth/reset', { token, password });
              setDone(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && (
            <div className="mb-2">
              <Alert variant="error">{error}</Alert>
            </div>
          )}
          <Field label={t('profile.newPassword')} help={t('auth.passwordHint', { n: settings.passwordMinLength })}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" required />
          </Field>
          <Field label={t('auth.passwordRepeat')}>
            <Input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />
          </Field>
          <Button type="submit" variant="primary" block icon={KeyRound} loading={busy}>
            {t('common.save')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
